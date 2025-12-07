import { readFile, writeFile } from './fileSystem';
import { Logger } from './logger';

export interface AutoSaveState {
    user: {
        id: string;
        email: string;
    };
    workspaces: Record<string, {
        id: string;
        last_check_time: number;
        // Key is Gizmo ID
        gizmos: Record<string, {
            id: string;
            last_check_time: number;
        }>;
    }>;
    // Key is the Conversation UUID
    conversations: Record<string, {
        id: string;
        update_time: number;
        saved_at: number;
        workspace_id: string;
        gizmo_id?: string;
    }>;
}

const STATE_FILENAME = 'autosave_state.json';

// In-memory cache
let stateCache: AutoSaveState | null = null;

export async function loadState(userFolder: FileSystemDirectoryHandle): Promise<AutoSaveState> {
    try {
        const content = await readFile(userFolder, STATE_FILENAME);
        const state = JSON.parse(content);
        // Ensure structure migration
        if (!state.workspaces) state.workspaces = {};
        if (!state.user) state.user = { id: '', email: '' };

        // Ensure all workspaces have gizmos object
        Object.values(state.workspaces).forEach((ws: any) => {
            if (!ws.gizmos) ws.gizmos = {};
        });

        stateCache = state;
        return state;
    } catch (e: any) {
        if (e.name !== 'NotFoundError') {
            Logger.warn('AutoSaveState', 'Failed to load state', e);
        }
    }
    // Return default empty state
    return {
        user: { id: '', email: '' },
        workspaces: {},
        conversations: {}
    };
}

export async function saveState(state: AutoSaveState, userFolder: FileSystemDirectoryHandle) {
    try {
        stateCache = state;
        await writeFile(userFolder, STATE_FILENAME, JSON.stringify(state, null, 2));
    } catch (e) {
        Logger.error('AutoSaveState', 'Failed to save state', e);
    }
}

export async function updateConversationState(
    userFolder: FileSystemDirectoryHandle,
    id: string,
    updateTime: number,
    savedAt: number,
    workspaceId: string,
    gizmoId?: string
) {
    const state = await loadState(userFolder);
    state.conversations[id] = {
        id,
        update_time: updateTime,
        saved_at: savedAt,
        workspace_id: workspaceId,
        gizmo_id: gizmoId
    };
    await saveState(state, userFolder);
}

export async function updateWorkspaceCheckTime(userFolder: FileSystemDirectoryHandle, workspaceId: string) {
    const state = await loadState(userFolder);
    if (!state.workspaces[workspaceId]) {
        state.workspaces[workspaceId] = { id: workspaceId, last_check_time: 0, gizmos: {} };
    }
    state.workspaces[workspaceId].last_check_time = Date.now();
    await saveState(state, userFolder);
}

export async function updateGizmoCheckTime(userFolder: FileSystemDirectoryHandle, workspaceId: string, gizmoId: string) {
    const state = await loadState(userFolder);

    // Ensure workspace exists
    if (!state.workspaces[workspaceId]) {
        state.workspaces[workspaceId] = { id: workspaceId, last_check_time: 0, gizmos: {} };
    }

    // Ensure gizmo exists
    if (!state.workspaces[workspaceId].gizmos) {
        state.workspaces[workspaceId].gizmos = {};
    }

    state.workspaces[workspaceId].gizmos[gizmoId] = {
        id: gizmoId,
        last_check_time: Date.now()
    };

    await saveState(state, userFolder);
}

// Helper to get state from cache if available
// Note: This needs the user folder now, so we can't just use it blindly without context.
// But mostly we use it inside the loop where we have the folder.
export function getCachedState(): AutoSaveState | null {
    return stateCache;
}
