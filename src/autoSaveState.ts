import { getRootHandle, readFile, writeFile } from './fileSystem';
import { Logger } from './logger';

export interface AutoSaveState {
    lastCheckTime: number;
    // Key is the Conversation UUID
    conversations: Record<string, {
        id: string;
        update_time: number;
        saved_at: number;
        workspace_id?: string;
    }>;
}

const STATE_FILENAME = 'autosave_state.json';

// In-memory cache to avoid reading FS on every check if possible, 
// but for correctness with multiple tabs, we might want to read often.
// For now, let's read from FS on every cycle start.
let stateCache: AutoSaveState | null = null;

export async function loadState(): Promise<AutoSaveState> {
    try {
        const root = await getRootHandle();
        if (!root) return { lastCheckTime: 0, conversations: {} };

        const content = await readFile(root, STATE_FILENAME);
        const state = JSON.parse(content);
        stateCache = state;
        return state;
    } catch (e: any) {
        if (e.name !== 'NotFoundError') {
            Logger.warn('AutoSaveState', 'Failed to load state', e);
        }
    }
    return { lastCheckTime: 0, conversations: {} };
}

export async function saveState(state: AutoSaveState) {
    try {
        const root = await getRootHandle();
        if (!root) return;
        stateCache = state;
        await writeFile(root, STATE_FILENAME, JSON.stringify(state, null, 2));
    } catch (e) {
        Logger.error('AutoSaveState', 'Failed to save state', e);
    }
}

export async function updateConversationState(id: string, updateTime: number, savedAt: number, workspaceId?: string) {
    const state = await loadState();
    state.conversations[id] = {
        id,
        update_time: updateTime,
        saved_at: savedAt,
        workspace_id: workspaceId
    };
    await saveState(state);
}

// Helper to get state from cache if available, or load it
export async function getConversationState(id: string): Promise<{ update_time: number } | null> {
    if (!stateCache) {
        await loadState();
    }
    return stateCache?.conversations[id] || null;
}
