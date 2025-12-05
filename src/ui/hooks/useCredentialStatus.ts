import { useState, useEffect } from 'preact/hooks';
import { Cred } from '../../cred';

export interface CredStatus {
    hasToken: boolean;
    hasAcc: boolean;
    debug: string;
}

export function useCredentialStatus() {
    const [status, setStatus] = useState<CredStatus>({ hasToken: false, hasAcc: false, debug: '' });

    const refreshCredStatus = async () => {
        await Cred.ensureViaSession();
        await Cred.ensureAccountId();
        setStatus({
            hasToken: !!Cred.token,
            hasAcc: !!Cred.accountId,
            debug: Cred.debug
        });
    };

    useEffect(() => {
        refreshCredStatus();
        const timer = setInterval(refreshCredStatus, 60 * 1000);
        return () => clearInterval(timer);
    }, []);

    return { status, refreshCredStatus };
}
