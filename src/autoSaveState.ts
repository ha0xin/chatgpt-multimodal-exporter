
export interface AutoSaveState {
    lastCheckTime: number;
    // Key is the Conversation UUID
    conversations: Record<string, {
        id: string;
        update_time: number;
        saved_at: number;
    }>;
}

const STORAGE_KEY = 'chatgpt_exporter_autosave_state';

export function loadState(): AutoSaveState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn('[AutoSave] Failed to load state', e);
    }
    return { lastCheckTime: 0, conversations: {} };
}

export function saveState(state: AutoSaveState) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('[AutoSave] Failed to save state', e);
    }
}

export function updateConversationState(id: string, updateTime: number, savedAt: number) {
    const state = loadState();
    state.conversations[id] = {
        id,
        update_time: updateTime,
        saved_at: savedAt,
    };
    saveState(state);
}

export function getConversationState(id: string) {
    const state = loadState();
    return state.conversations[id] || null;
}
