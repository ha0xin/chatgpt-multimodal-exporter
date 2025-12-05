import { listConversationsPage, listGizmosSidebar, listProjectConversations, fetchConvWithRetry } from './conversations';
import { loadState, updateConversationState } from './autoSaveState';
import { getRootHandle, verifyPermission, ensureFolder, writeFile, fileExists } from './fileSystem';
import { collectFileCandidates } from './files';
import { downloadPointerOrFileAsBlob } from './downloads';
import { sanitize } from './utils';
import { Conversation } from './types';

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

async function saveConversationToDisk(handle: FileSystemDirectoryHandle, conv: Conversation) {
    const id = conv.conversation_id;
    const folderName = id; // Use ID as folder name
    const convFolder = await ensureFolder(handle, folderName);

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
                // Try to predict filename to check existence
                let predictedName = '';
                if (c.meta && (c.meta.name || c.meta.file_name)) {
                    predictedName = sanitize(c.meta.name || c.meta.file_name);
                }

                // If we have a predicted name, check if it exists
                // Note: This is a heuristic. If multiple files have same name, this might be risky.
                // But sanitize() handles some chars. 
                // Ideally we should match file_id too, but we don't store file_id in filename usually.
                // Let's assume if filename matches, it's the same file for now (optimization).

                if (predictedName && await fileExists(attFolder, predictedName)) {
                    const mime = c.meta?.mime_type || c.meta?.mime || 'application/octet-stream';
                    meta.attachments.push({
                        file_id: c.file_id,
                        name: predictedName,
                        mime: mime,
                    });
                    continue;
                }

                const res = await downloadPointerOrFileAsBlob(c);
                const safeName = sanitize(res.filename);

                // Double check existence with the actual resolved filename
                if (predictedName !== safeName && await fileExists(attFolder, safeName)) {
                    meta.attachments.push({
                        file_id: c.file_id,
                        name: safeName,
                        mime: res.mime,
                    });
                    continue;
                }

                await writeFile(attFolder, safeName, res.blob);
                meta.attachments.push({
                    file_id: c.file_id,
                    name: safeName,
                    mime: res.mime,
                });
            } catch (e) {
                console.warn('Failed to save attachment', c, e);
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

    try {
        const state = loadState();
        const candidates: { id: string; projectId?: string; update_time: string }[] = [];

        // 1. Check Personal Conversations
        const personalPage = await listConversationsPage({ limit: 20, order: 'updated' });
        if (personalPage?.items) {
            for (const item of personalPage.items) {
                const local = state.conversations[item.id];
                const remoteTime = new Date(item.update_time).getTime();
                if (!local || remoteTime > local.update_time) {
                    candidates.push({ id: item.id, update_time: item.update_time });
                }
            }
        }

        // 2. Check Projects
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
            const projPage = await listProjectConversations({ projectId: pid, limit: 10 });
            if (projPage?.items) {
                for (const item of projPage.items) {
                    const local = state.conversations[item.id];
                    const remoteTime = item.update_time ? new Date(item.update_time).getTime() : Date.now();

                    if (!local || remoteTime > local.update_time) {
                        candidates.push({ id: item.id, projectId: pid, update_time: item.update_time });
                    }
                }
            }
        }

        if (candidates.length === 0) {
            setStatus('idle', 'No updates found');
            return;
        }

        setStatus('saving', `Saving ${candidates.length} conversations...`);

        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            setStatus('saving', `Saving ${i + 1}/${candidates.length}: ${c.id}`);

            const conv = await fetchConvWithRetry(c.id, c.projectId);
            await saveConversationToDisk(rootHandle, conv);

            updateConversationState(c.id, new Date(c.update_time).getTime(), Date.now());
        }

        setStatus('idle', 'All saved');

    } catch (e: any) {
        console.error('Auto-save failed', e);
        setStatus('error', e.message || 'Unknown error');
    }
}

let loopTimer: number | null = null;

export function startAutoSaveLoop(intervalMs = 5 * 60 * 1000) {
    if (loopTimer) return;
    runAutoSave(); // Run immediately
    loopTimer = window.setInterval(runAutoSave, intervalMs);
}

export function stopAutoSaveLoop() {
    if (loopTimer) {
        clearInterval(loopTimer);
        loopTimer = null;
    }
}
