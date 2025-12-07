import { listConversationsPage, listGizmosSidebar, listProjectConversations, fetchConvWithRetry } from './conversations';
import { Cred } from './cred';
import { loadState, updateConversationState, updateWorkspaceCheckTime, updateGizmoCheckTime, saveState } from './autoSaveState';
import { getRootHandle, verifyPermission, ensureFolder, writeFile, fileExists } from './fileSystem';
import { collectFileCandidates } from './files';
import { downloadPointerOrFileAsBlob } from './downloads';
import { sanitize } from './utils';
import { Conversation } from './types';
import { Logger } from './logger';
import { autoSaveStore } from './state/autoSaveStore';
import { runExclusiveStateOp, tryAcquireLeader } from './mutex';

// Re-export file system helpers for UI
export { pickAndSaveRootHandle, getRootHandle } from './fileSystem';

// Type re-export for compatibility if needed (though UI should migrate to store)
import { AutoSaveState } from './state/autoSaveStore';
export interface AutoSaveStatus {
    lastRun: number;
    state: AutoSaveState;
    message: string;
}

/**
 * Saves a single conversation to disk.
 * MUST be called within a lock (runExclusiveStateOp).
 */
async function saveConversationToDisk(userFolder: FileSystemDirectoryHandle, conv: Conversation, parentFolderName: string) {
    const id = conv.conversation_id;

    // Ensure parent folder (Personal or WorkspaceID inside User folder)
    const parentFolder = await ensureFolder(userFolder, parentFolderName);
    // Ensure conversation folder
    const convFolder = await ensureFolder(parentFolder, id);

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
 * NOW wrapped in mutex by caller or inside here?
 * Since this function does IO and State updates, we should wrap the critical part.
 * However, we want the "Check -> Save" to be atomic relative to State to avoid double processing.
 */
export async function runAutoSaveCycle() {
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

    autoSaveStore.setStatus('checking', 'Checking for updates...');
    Logger.info('AutoSave', 'Starting auto-save cycle');

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

            // 1. Check Personal/Workspace Conversations
            const currentWorkspaceId = Cred.accountId;

            // Track check time for this workspace context
            let currentWorkspaceKey = 'personal';
            if (currentWorkspaceId && currentWorkspaceId !== 'personal' && currentWorkspaceId !== 'x') {
                currentWorkspaceKey = currentWorkspaceId;
            }
            await updateWorkspaceCheckTime(userFolder, currentWorkspaceKey);

            const personalPage = await listConversationsPage({ limit: 20, order: 'updated' });

            if (personalPage?.items) {
                for (const item of personalPage.items) {
                    const local = state.conversations[item.id];
                    const remoteTime = new Date(item.update_time).getTime();

                    // Determine folder name (Project or Personal or WorkspaceID)
                    let folderName = 'Personal';
                    if (item.workspace_id) {
                        folderName = item.workspace_id;
                    } else if (currentWorkspaceId && currentWorkspaceId !== 'x') {
                        folderName = currentWorkspaceId;
                    }

                    if (!local || remoteTime > local.update_time) {
                        candidates.push({
                            id: item.id,
                            update_time: item.update_time,
                            folder: folderName,
                            workspaceKey: currentWorkspaceKey
                        });
                    }
                }
            }

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
                // Update check time
                await updateGizmoCheckTime(userFolder, currentWorkspaceKey, pid);

                const projPage = await listProjectConversations({ projectId: pid, limit: 10 });
                if (projPage?.items) {
                    for (const item of projPage.items) {
                        const local = state.conversations[item.id];
                        const remoteTime = item.update_time ? new Date(item.update_time).getTime() : Date.now();

                        if (!local || remoteTime > local.update_time) {
                            candidates.push({
                                id: item.id,
                                projectId: pid,
                                update_time: item.update_time,
                                folder: pid,
                                workspaceKey: currentWorkspaceKey
                            });
                        }
                    }
                }
            }

            if (candidates.length === 0) {
                autoSaveStore.setStatus('idle', 'No updates found');
                autoSaveStore.setLastRun(Date.now());
                Logger.info('AutoSave', 'No updates found');
                return;
            }

            autoSaveStore.setStatus('saving', `Saving ${candidates.length} conversations...`);
            Logger.info('AutoSave', `Found ${candidates.length} updates`);

            for (let i = 0; i < candidates.length; i++) {
                const c = candidates[i];
                const typeStr = c.projectId ? `[Gizmo ${c.projectId}]` : `[${c.folder}]`;
                autoSaveStore.setStatus('saving', `Saving ${i + 1}/${candidates.length}: ${typeStr} ${c.id}`);
                Logger.info('AutoSave', `Saving ${c.id} to ${c.folder}`);

                const conv = await fetchConvWithRetry(c.id, c.projectId);
                await saveConversationToDisk(userFolder, conv, c.folder);

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
export const runAutoSave = runAutoSaveCycle;


// --- Leader Election & Loop ---

let stopRequested = false;
let isStarted = false;

// The loop that Only the Leader runs
async function leaderLoop(intervalMs: number) {
    Logger.info('AutoSave', 'I am the Leader. Starting loop.');
    
    while (!stopRequested) {
        // Calculate Next Run
        const nextRun = Date.now() + intervalMs;
        autoSaveStore.setNextRun(nextRun);
        
        // Wait for interval (breakable?)
        // Simple wait for now
        await new Promise(r => setTimeout(r, intervalMs));
        if (stopRequested) break;

        await runAutoSaveCycle();
    }
}

// Global start function
export async function startAutoSaveLoop(intervalMs = 5 * 60 * 1000) {
    if (isStarted) return;
    isStarted = true;
    stopRequested = false;
    Logger.info('AutoSave', `Initializing AutoSave system...`);
    
    // Initial check (Leader election logic)
    attemptLeaderElection(intervalMs);
}

// Recursive election attempt
async function attemptLeaderElection(intervalMs: number) {
    if (stopRequested) return;

    try {
        const acquired = await tryAcquireLeader(async () => {
            // Callback runs ONLY when we are leader
            autoSaveStore.setRole('leader');
            try {
                // Run one immediately upon becoming leader?
                // Yes, usually good practice.
                await runAutoSaveCycle(); 
                
                await leaderLoop(intervalMs);
            } finally {
                // We lost leadership or loop stopped
                autoSaveStore.setRole('unknown'); // Will become standby or leader again shortly
            }
        });

        if (!acquired) {
            // We are Standby
            autoSaveStore.setRole('standby');
            autoSaveStore.setNextRun(0); // Clear next run if standby? Or maybe show "Standby"
            
            // Wait and retry
            // If tryAcquireLeader used {ifAvailable: true}, it returns immediately.
            // We poll every 10 seconds to see if leader died.
            setTimeout(() => attemptLeaderElection(intervalMs), 10000);
        } else {
            // If we returned from acquired=true, it means we LOST leadership (loop finished or error)
            // We should retry becoming leader immediately or after delay
            if (!stopRequested) {
                 setTimeout(() => attemptLeaderElection(intervalMs), 1000);
            }
        }
    } catch (e) {
        Logger.error('AutoSave', 'Election error', e);
        // Retry logic needed
        setTimeout(() => attemptLeaderElection(intervalMs), 10000);
    }
}

export function stopAutoSaveLoop() {
    stopRequested = true;
    isStarted = false;
    Logger.info('AutoSave', 'Stopping loop requested');
}
