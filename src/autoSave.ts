import { listConversationsPage, listGizmosSidebar, listProjectConversations, fetchConvWithRetry } from './conversations';
import { Cred } from './cred';
import { loadState, updateConversationState, updateWorkspaceCheckTime, updateGizmoCheckTime, saveState } from './autoSaveState';
import { getRootHandle, verifyPermission, ensureFolder, writeFile, fileExists } from './fileSystem';
import { collectFileCandidates } from './files';
import { downloadPointerOrFileAsBlob } from './downloads';
import { sanitize } from './utils';
import { Conversation } from './types';
import { Logger } from './logger';

// Re-export file system helpers for UI
export { pickAndSaveRootHandle, getRootHandle } from './fileSystem';

export interface AutoSaveStatus {
    lastRun: number;
    state: 'idle' | 'checking' | 'saving' | 'error';
    message: string;
}

let currentStatus: AutoSaveStatus = { lastRun: 0, state: 'idle', message: '' };
let listeners: ((status: AutoSaveStatus) => void)[] = [];

export function subscribeStatus(cb: (status: AutoSaveStatus) => void) {
    listeners.push(cb);
    cb(currentStatus);
    return () => {
        listeners = listeners.filter((x) => x !== cb);
    };
}

function setStatus(state: AutoSaveStatus['state'], message: string) {
    currentStatus = { ...currentStatus, state, message, lastRun: Date.now() };
    listeners.forEach((cb) => cb(currentStatus));
}

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

export async function runAutoSave() {
    if (currentStatus.state !== 'idle' && currentStatus.state !== 'error') return;

    const rootHandle = await getRootHandle();
    if (!rootHandle) {
        setStatus('error', 'Auto-save not configured');
        return;
    }

    if (!(await verifyPermission(rootHandle, true))) {
        setStatus('error', 'Permission denied');
        return;
    }

    setStatus('checking', 'Checking for updates...');
    Logger.info('AutoSave', 'Starting auto-save cycle');

    try {
        // Strict check: User must be identified by email
        if (!Cred.userLabel) {
            throw new Error('User email not found (Strict Mode)');
        }

        // Ensure User folder (Email)
        const userFolder = await ensureFolder(rootHandle, Cred.userLabel);

        const state = await loadState(userFolder); // Async load

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
                // For main list, it's either Personal or the Workspace ID
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
            // Update check time for project (Gizmo) UNDER the current workspace
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
                            // Store under current workspace, separate folder?
                            // User request implies strict nesting in state, but folder structure is less clear.
                            // keeping flattened folder structure [User]/[GizmoID]/... for now as it's cleaner for file browsing
                            // UNLESS user complains.
                            // But for STATE tracking, we pass workspaceKey.

                            folder: pid,
                            workspaceKey: currentWorkspaceKey
                        });
                    }
                }
            }
        }

        if (candidates.length === 0) {
            setStatus('idle', 'No updates found');
            Logger.info('AutoSave', 'No updates found');
            return;
        }

        setStatus('saving', `Saving ${candidates.length} conversations...`);
        Logger.info('AutoSave', `Found ${candidates.length} updates`);

        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            const typeStr = c.projectId ? `[Gizmo ${c.projectId}]` : `[${c.folder}]`;
            setStatus('saving', `Saving ${i + 1}/${candidates.length}: ${typeStr} ${c.id}`);
            Logger.info('AutoSave', `Saving ${c.id} to ${c.folder}`);

            const conv = await fetchConvWithRetry(c.id, c.projectId);
            await saveConversationToDisk(userFolder, conv, c.folder);

            await updateConversationState(
                userFolder,
                c.id,
                new Date(c.update_time).getTime(),
                Date.now(),
                c.workspaceKey,
                c.projectId // Pass gizmo_id if present
            );
        }

        setStatus('idle', 'All saved');
        Logger.info('AutoSave', 'Cycle completed successfully');

    } catch (e: any) {
        Logger.error('AutoSave', 'Auto-save failed', e);
        setStatus('error', e.message || 'Unknown error');
    }
}

let loopTimer: number | null = null;

export function startAutoSaveLoop(intervalMs = 5 * 60 * 1000) {
    if (loopTimer) return;
    Logger.info('AutoSave', `Starting loop with interval ${intervalMs}ms`);
    runAutoSave(); // Run immediately
    loopTimer = window.setInterval(runAutoSave, intervalMs);
}

export function stopAutoSaveLoop() {
    if (loopTimer) {
        Logger.info('AutoSave', 'Stopping loop');
        clearInterval(loopTimer);
        loopTimer = null;
    }
}
