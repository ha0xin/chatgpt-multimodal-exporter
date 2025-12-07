
import { useState, useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { autoSaveStore, AutoSaveState, AutoSaveRole } from '../../state/autoSaveStore';

export interface AutoSaveUIState {
    status: AutoSaveState;
    message: string;
    lastRun: number;
    nextRun: number;
    role: AutoSaveRole;
    isLeader: boolean;
    lastError: string | null;
}

export function useAutoSave(): AutoSaveUIState {
    const [state, setState] = useState<AutoSaveUIState>({
        status: autoSaveStore.status.value,
        message: autoSaveStore.message.value,
        lastRun: autoSaveStore.lastRun.value,
        nextRun: autoSaveStore.nextRun.value,
        role: autoSaveStore.role.value,
        isLeader: autoSaveStore.isLeader.value,
        lastError: autoSaveStore.lastError.value
    });

    useEffect(() => {
        const dispose = effect(() => {
            setState({
                status: autoSaveStore.status.value,
                message: autoSaveStore.message.value,
                lastRun: autoSaveStore.lastRun.value,
                nextRun: autoSaveStore.nextRun.value,
                role: autoSaveStore.role.value,
                isLeader: autoSaveStore.isLeader.value,
                lastError: autoSaveStore.lastError.value
            });
        });
        return dispose;
    }, []);

    return state;
}
