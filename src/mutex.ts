
import { Logger } from './logger';

export const STATE_LOCK_NAME = 'chatgpt_exporter_state_mutex';
export const LEADER_LOCK_NAME = 'chatgpt_exporter_autosave_leader';

/**
 * Runs a critical section of code that reads/modifies/writes the global state.
 * Uses navigator.locks to ensure only one tab/process touches the state file at a time.
 * 
 * @param callback Async function to execute within the lock
 */
export async function runExclusiveStateOp<T>(callback: () => Promise<T>): Promise<T> {
    if (!navigator.locks) {
        throw new Error('Web Locks API is not supported. AutoSave disabled.');
    }

    return navigator.locks.request(STATE_LOCK_NAME, { mode: 'exclusive' }, async () => {
        try {
            return await callback();
        } catch (e) {
            Logger.error('Mutex', 'Error inside exclusive state operation', e);
            throw e;
        }
    });
}

/**
 * Attempts to acquire the leader lock. 
 * If successful, runs the callback (the autosave loop) indefinitely until the callback returns or the tab closes.
 * If the lock is held by another tab, this returns immediately (ifAvailable: true).
 * 
 * @param onLeaderAcquired Async function to run when leader is acquired. Should return a promise that resolves when leadership ends/is yielded.
 * @returns true if lock was acquired, false otherwise.
 */
export async function tryAcquireLeader(onLeaderAcquired: () => Promise<void>): Promise<boolean> {
    if (!navigator.locks) {
        throw new Error('Web Locks API is not supported. AutoSave disabled.');
    }

    // request with ifAvailable: true returns null if lock is held by someone else
    const result = await navigator.locks.request(LEADER_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
            // Lock not acquired
            return false;
        }
        
        // Lock acquired! I am the Leader.
        Logger.info('Mutex', 'Leader lock acquired. Starting AutoSave loop.');
        try {
            await onLeaderAcquired();
        } finally {
            Logger.info('Mutex', 'Leader lock released.');
        }
        return true;
    });

    return result === true;
}
