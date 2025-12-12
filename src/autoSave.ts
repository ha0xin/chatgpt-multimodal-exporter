import { listConversationsPage, listGizmosSidebar, listProjectConversations, fetchConvWithRetry, scanPagination } from './conversations';
import { Cred } from './cred';
import { loadState, updateConversationState, updateWorkspaceCheckTime, updateGizmoCheckTime, saveState } from './autoSaveState'; 
import { getRootHandle, verifyPermission, ensureFolder, writeFile, fileExists } from './fileSystem';
import { collectFileCandidates } from './files';
import { downloadPointerOrFileAsBlob } from './downloads';
import { sanitize } from './utils';
import { Conversation } from './types';
import { Logger } from './logger';
import { autoSaveStore, AutoSaveState } from './state/autoSaveStore';
import { runExclusiveStateOp, tryAcquireLeader } from './mutex';

// Re-export file system helpers for UI
export { pickAndSaveRootHandle, getRootHandle } from './fileSystem';

export interface AutoSaveStatus {
    lastRun: number;
    state: AutoSaveState;
    message: string;
}

/**
 * Saves a single conversation to disk.
 * MUST be called within a lock (runExclusiveStateOp).
 * 
 * Structure: UserFolder / WorkspaceFolder / CategoryFolder / ConversationID
 */
async function saveConversationToDisk(
    userFolder: FileSystemDirectoryHandle, 
    conv: Conversation, 
    workspaceName: string,
    categoryName: string
) {
    const id = conv.conversation_id;

    // 1. Ensure Workspace Folder (Personal or WorkspaceID)
    const wsFolder = await ensureFolder(userFolder, workspaceName);
    
    // 2. Ensure Category Folder (ProjectID or 'conversations')
    const catFolder = await ensureFolder(wsFolder, categoryName);

    // 3. Ensure Conversation Folder
    const convFolder = await ensureFolder(catFolder, id);

    // 1. Save conversation.json
    await writeFile(convFolder, 'conversation.json', JSON.stringify(conv, null, 2));

    // 2. Save metadata.json
    const meta = {
        id: conv.conversation_id,
        title: conv.title,
        create_time: conv.create_time,
        update_time: conv.update_time,
        model_slug: conv.default_model_slug,
        attachments: [] as any[],
    };

    // 3. Save attachments
    const candidates = collectFileCandidates(conv);
    if (candidates.length > 0) {
        const attFolder = await ensureFolder(convFolder, 'attachments');
        for (const c of candidates) {
            try {
                let predictedName = '';
                if (c.meta && (c.meta.name || c.meta.file_name)) {
                    predictedName = sanitize(c.meta.name || c.meta.file_name);
                }

                if (predictedName && await fileExists(attFolder, predictedName)) {
                    const mime = c.meta?.mime_type || c.meta?.mime || 'application/octet-stream';
                    meta.attachments.push({
                        file_id: c.file_id,
                        name: predictedName,
                        mime: mime,
                    });
                    Logger.debug('AutoSave', `Attachment exists (predicted): ${predictedName}`);
                    continue;
                }

                const res = await downloadPointerOrFileAsBlob(c);
                const safeName = sanitize(res.filename);

                if (predictedName !== safeName && await fileExists(attFolder, safeName)) {
                    meta.attachments.push({
                        file_id: c.file_id,
                        name: safeName,
                        mime: res.mime,
                    });
                    Logger.debug('AutoSave', `Attachment exists (resolved): ${safeName}`);
                    continue;
                }

                await writeFile(attFolder, safeName, res.blob);
                meta.attachments.push({
                    file_id: c.file_id,
                    name: safeName,
                    mime: res.mime,
                });
                Logger.debug('AutoSave', `Saved attachment: ${safeName}`);
            } catch (e) {
                Logger.warn('AutoSave', 'Failed to save attachment', c, e);
            }
        }
    }

    await writeFile(convFolder, 'metadata.json', JSON.stringify(meta, null, 2));
}

/**
 * Single run of the auto-save logic.
 * @param forceFullScan If true, scans ALL conversations regardless of update time.
 */
export async function runAutoSaveCycle(forceFullScan = false) {
    // If already running (shouldn't happen if serial, but good safety)
    if (autoSaveStore.status.value === 'saving' || autoSaveStore.status.value === 'checking') return;

    const rootHandle = await getRootHandle();
    if (!rootHandle) {
        autoSaveStore.setError('Auto-save not configured');
        return;
    }

    if (!(await verifyPermission(rootHandle, true))) {
        autoSaveStore.setError('Permission denied');
        return;
    }

    const modeLabel = forceFullScan ? 'Full Scan' : 'Auto-save';
    autoSaveStore.setStatus('checking', `${modeLabel}: Checking for updates...`);
    Logger.info('AutoSave', `Starting ${modeLabel} cycle`);

    try {
        // Enforce Mutex for the entire read-check-write cycle
        await runExclusiveStateOp(async () => {
             // Strict check: User must be identified by email
            if (!Cred.userLabel) {
                throw new Error('User email not found (Strict Mode)');
            }

            // Ensure User folder (Email)
            const userFolder = await ensureFolder(rootHandle, Cred.userLabel);
            
            // NOTE: loadState is called inside here
            const state = await loadState(userFolder); 

            // Update User Info in State
            if (state.user.id !== (Cred.accountId || '') || state.user.email !== Cred.userLabel) {
                state.user = {
                    id: Cred.accountId || '',
                    email: Cred.userLabel!
                };
                await saveState(state, userFolder);
            }

            const candidates: { id: string; projectId?: string; update_time: string; folder: string, workspaceKey: string }[] = [];
            const currentWorkspaceId = Cred.accountId;

            // Track check time for this workspace context
            let currentWorkspaceKey = 'personal';
            if (currentWorkspaceId && currentWorkspaceId !== 'personal' && currentWorkspaceId !== 'x') {
                currentWorkspaceKey = currentWorkspaceId;
            }
            await updateWorkspaceCheckTime(userFolder, currentWorkspaceKey);

            // Helper to generate candidate processor
            const createProcessor = (
                folderResolver: (item: any) => string, 
                workspaceKey: string,
                projectId?: string
            ) => {
                return async (items: any[]) => {
                    let hasNewInPage = false;
                    for (const item of items) {
                        const local = state.conversations[item.id];
                        const remoteTime = item.update_time ? new Date(item.update_time).getTime() : Date.now();

                        // Determine folder name
                        const folderName = folderResolver(item);

                        if (forceFullScan || !local || remoteTime > local.update_time) {
                            candidates.push({
                                id: item.id,
                                projectId: projectId,
                                update_time: item.update_time,
                                folder: folderName,
                                workspaceKey: workspaceKey
                            });
                            hasNewInPage = true;
                        }
                    }
                    
                    // Stop scanning if NOT full scan and NO new items in this page
                    // (Assuming chronological order, older items are clean)
                    if (!forceFullScan && !hasNewInPage) {
                        return false; 
                    }
                    return true;
                };
            };

            // 1. Check Personal/Workspace Conversations
            // Personal Fetcher wrapper
            const personalFetcher = (offset: number, limit: number) => listConversationsPage({ offset, limit, order: 'updated' });
            
            const personalProcessor = createProcessor((item) => {
                if (item.workspace_id) return item.workspace_id;
                if (currentWorkspaceId && currentWorkspaceId !== 'x') return currentWorkspaceId;
                return 'Personal';
            }, currentWorkspaceKey);

            await scanPagination(personalFetcher, personalProcessor, 0, 20);

            // 2. Check Projects (Gizmos)
            const sidebar = await listGizmosSidebar();
            const projects = new Set<string>();

            if (sidebar?.gizmos) {
                sidebar.gizmos.forEach((g: any) => g.id && projects.add(g.id));
            }
            if (sidebar?.items) {
                sidebar.items.forEach((it: any) => {
                    const gid = it?.gizmo?.gizmo?.id || it?.gizmo?.id;
                    if (gid) projects.add(gid);
                });
            }

            for (const pid of projects) {
                await updateGizmoCheckTime(userFolder, currentWorkspaceKey, pid);

                const projFetcher = (cursor: number, limit: number) => listProjectConversations({ projectId: pid, cursor, limit });
                const projProcessor = createProcessor(() => pid, currentWorkspaceKey, pid);

                await scanPagination(projFetcher, projProcessor, 0, 50);
            }

            if (candidates.length === 0) {
                autoSaveStore.setStatus('idle', 'No updates found');
                autoSaveStore.setLastRun(Date.now());
                Logger.info('AutoSave', 'No updates found');
                return;
            }

            autoSaveStore.setStatus('saving', `Saving ${candidates.length} conversations...`);
            Logger.info('AutoSave', `Found ${candidates.length} updates`);

            const REGULAR_FOLDER = 'conversations';

            for (let i = 0; i < candidates.length; i++) {
                const c = candidates[i];
                // category is project ID or 'conversations'
                const category = c.projectId || REGULAR_FOLDER;
                
                const typeStr = c.projectId ? `[Gizmo ${c.projectId}]` : `[${c.workspaceKey}]`;
                autoSaveStore.setStatus('saving', `Saving ${i + 1}/${candidates.length}: ${typeStr} ${c.id}`);
                Logger.info('AutoSave', `Saving ${c.id} to ${c.workspaceKey}/${category}`);

                const conv = await fetchConvWithRetry(c.id, c.projectId);
                
                // Determine workspace folder name: 'Personal' or the workspace ID
                let wsFolderName = 'Personal';
                if (c.workspaceKey && c.workspaceKey !== 'personal') {
                    wsFolderName = c.workspaceKey;
                }

                await saveConversationToDisk(userFolder, conv, wsFolderName, category);

                await updateConversationState(
                    userFolder,
                    c.id,
                    new Date(c.update_time).getTime(),
                    Date.now(),
                    c.workspaceKey,
                    c.projectId 
                );
            }

            autoSaveStore.setStatus('idle', 'All saved');
            autoSaveStore.setLastRun(Date.now());
            autoSaveStore.resetError();
            Logger.info('AutoSave', 'Cycle completed successfully');
        });

    } catch (e: any) {
        Logger.error('AutoSave', 'Auto-save failed', e);
        autoSaveStore.setError(e.message || 'Unknown error');
    }
}

// Legacy alias for UI components
export const runAutoSave = () => runAutoSaveCycle(false);
export const runFullAutoSave = () => runAutoSaveCycle(true);



// --- Leader Election & Loop ---

// --- Leader Election & Loop ---

let stopRequested = false;
let isStarted = false;
let interruptSleep: (() => void) | null = null;
let currentIntervalMs = 5 * 60 * 1000;

// The loop that Only the Leader runs
async function leaderLoop() {
    Logger.info('AutoSave', 'I am the Leader. Starting loop.');
    
    while (!stopRequested) {
        // Calculate Next Run
        const nextRun = Date.now() + currentIntervalMs;
        autoSaveStore.setNextRun(nextRun);
        
        // Wait for interval (Interruptible)
        await new Promise<void>(resolve => {
            interruptSleep = resolve;
            setTimeout(resolve, currentIntervalMs);
        });
        interruptSleep = null;

        if (stopRequested) break;

        await runAutoSaveCycle();
    }
}

// Global start function
export async function startAutoSaveLoop(intervalMs: number = 5 * 60 * 1000) {
    currentIntervalMs = intervalMs;

    if (isStarted) {
        // If already started, just ensure the interval is updated (which we did above)
        // And optionally wake up the loop to apply it immediately?
        // For now, next cycle will pick it up, or if we want immediate effect:
        if (autoSaveStore.role.value === 'leader' && interruptSleep) {
             Logger.info('AutoSave', 'Updating interval on running loop');
             interruptSleep();
        }
        return;
    }

    isStarted = true;
    stopRequested = false;
    Logger.info('AutoSave', `Initializing AutoSave system...`);
    autoSaveStore.setStatus('idle', 'Starting...');
    
    // Initial check (Leader election logic)
    attemptLeaderElection();
}

// Recursive election attempt
async function attemptLeaderElection() {
    if (stopRequested) return;

    try {
        const acquired = await tryAcquireLeader(async () => {
            // Callback runs ONLY when we are leader
            autoSaveStore.setRole('leader');
            try {
                // Run one immediately upon becoming leader?
                // Yes, usually good practice.
                await runAutoSaveCycle(); 
                
                await leaderLoop();
            } finally {
                // We lost leadership or loop stopped
                autoSaveStore.setRole('unknown'); // Will become standby or leader again shortly
            }
        });

        if (!acquired) {
            // We are Standby
            autoSaveStore.setRole('standby');
            autoSaveStore.setStatus('idle', 'Standby: Another tab is auto-saving');
            autoSaveStore.setNextRun(0); 
            
            // Wait and retry
            // If tryAcquireLeader used {ifAvailable: true}, it returns immediately.
            // We poll every 10 seconds to see if leader died.
            setTimeout(() => attemptLeaderElection(), 10000);
        } else {
            // If we returned from acquired=true, it means we LOST leadership (loop finished or error)
            // We should retry becoming leader immediately or after delay
            if (!stopRequested) {
                 setTimeout(() => attemptLeaderElection(), 1000);
            }
        }
    } catch (e) {
        Logger.error('AutoSave', 'Election error', e);
        // Retry logic needed
        setTimeout(() => attemptLeaderElection(), 10000);
    }
}

export function stopAutoSaveLoop() {
    stopRequested = true;
    isStarted = false;
    
    // Wake up leader loop if sleeping
    if (interruptSleep) {
        interruptSleep();
        interruptSleep = null;
    }

    autoSaveStore.setStatus('disabled', 'Auto-save disabled');
    Logger.info('AutoSave', 'Stopping loop requested');
}
