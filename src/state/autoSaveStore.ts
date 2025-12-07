
import { signal, computed } from '@preact/signals';

export type AutoSaveState = 'idle' | 'checking' | 'saving' | 'error' | 'disabled';
export type AutoSaveRole = 'leader' | 'standby' | 'unknown';

// Internal State Signals
const _status = signal<AutoSaveState>('idle');
const _message = signal<string>('');
const _lastRun = signal<number>(0);
const _nextRun = signal<number>(0);
const _role = signal<AutoSaveRole>('unknown');
const _lastError = signal<string | null>(null);

// Computed / Derived
const _isLeader = computed(() => _role.value === 'leader');

export const autoSaveStore = {
    // Read-only signals for UI
    status: _status,
    message: _message,
    lastRun: _lastRun,
    nextRun: _nextRun,
    role: _role,
    lastError: _lastError,
    isLeader: _isLeader,

    // Actions
    setStatus(state: AutoSaveState, msg: string = '') {
        _status.value = state;
        _message.value = msg;
    },
    
    setRole(role: AutoSaveRole) {
        _role.value = role;
    },

    setLastRun(time: number) {
        _lastRun.value = time;
    },

    setNextRun(time: number) {
        _nextRun.value = time;
    },

    setError(errorMsg: string) {
        _status.value = 'error';
        _message.value = errorMsg;
        _lastError.value = errorMsg;
    },
    
    resetError() {
        if (_status.value === 'error') {
            _status.value = 'idle';
            _message.value = '';
        }
        _lastError.value = null;
    }
};
