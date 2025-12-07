import { Logger } from './logger';
import { unsafeWindow } from '$';

export const Cred = (() => {
  let token: string | null = null;
  let accountId: string | null = null;
  let mainUser: string | null = null; // Email or name

  // Track sources for debugging/logging
  let tokenSource: string = '';
  let accountIdSource: string = '';

  let lastErr = '';
  // Avoid re-initializing interceptors if module is re-evaluated (though unlikely in this setup)
  let interceptorsInitialized = false;

  const log = (key: 'Token' | 'Account ID' | 'User', val: string, source: string) => {
    console.log(`[Cred] ${key} captured via ${source}:`, val);
  };

  const mask = (s: string | null, keepL = 8, keepR = 4): string => {
    if (!s) return '';
    if (s.length <= keepL + keepR) return s;
    return `${s.slice(0, keepL)}…${s.slice(-keepR)}`;
  };

  // --- 1. Network Interception (Passive) ---
  const initInterceptors = () => {
    if (interceptorsInitialized) return;
    interceptorsInitialized = true;

    const originalFetch = window.fetch;
    window.fetch = async function (_input, init) {
      // Capture from request headers
      if (init && init.headers) {
        captureFromHeaders(init.headers);
      }
      return originalFetch.apply(this, arguments as any);
    };

    // Also hook XMLHttpRequest for completeness
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (_method, _url) {
      this.addEventListener('readystatechange', () => {
        if (this.readyState === 1) { // OPENED, headers might be set later, but we can't intercept setRequestHeader easily without proxying it.
          // Actually, we need to proxy setRequestHeader to capture outgoing headers for XHR.
          // For simplicity and since fetch is primary, we'll skip complex XHR header proxying unless needed.
          // Most ChatGPT calls use fetch.
        }
      });
      return originalOpen.apply(this, arguments as any);
    };

    // Better XHR capture: override setRequestHeader
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
      if (header.toLowerCase() === 'authorization') {
        updateToken(value, 'Network (XHR)');
      }
      if (header.toLowerCase() === 'chatgpt-account-id') {
        updateAccountId(value, 'Network (XHR)');
      }
      return originalSetRequestHeader.apply(this, arguments as any);
    };

    console.log('[Cred] Network interceptors initialized');
  };

  const captureFromHeaders = (headers: HeadersInit) => {
    try {
      let auth: string | null = null;
      let accId: string | null = null;

      if (headers instanceof Headers) {
        auth = headers.get('authorization') || headers.get('Authorization');
        accId = headers.get('chatgpt-account-id') || headers.get('ChatGPT-Account-Id');
      } else if (Array.isArray(headers)) {
        // limit iteration
        for (const [k, v] of headers) {
          if (k.toLowerCase() === 'authorization') auth = v;
          if (k.toLowerCase() === 'chatgpt-account-id') accId = v;
        }
      } else {
        // Record<string, string>
        for (const k in headers) {
          if (k.toLowerCase() === 'authorization') auth = headers[k];
          if (k.toLowerCase() === 'chatgpt-account-id') accId = headers[k];
        }
      }

      if (auth) updateToken(auth, 'Network (Fetch)');
      if (accId) updateAccountId(accId, 'Network (Fetch)');
    } catch (e) {
      // ignore intercept errors
    }
  };

  const updateToken = (rawVal: string, source: string) => {
    if (!rawVal) return;
    const clean = rawVal.replace(/^Bearer\s+/i, '').trim();
    if (!clean || clean.toLowerCase() === 'undefined' || clean.toLowerCase() === 'null' || clean.toLowerCase() === 'dummy') return;

    // Always log for debugging verification as requested
    // Note: This might be noisy, but it proves interception works
    // log('Token', clean, source);

    // Only update if changed or simpler source
    if (token !== clean) {
      token = clean;
      tokenSource = source;
    }
  };

  const updateAccountId = (val: string, source: string) => {
    if (!val) return;
    const clean = val.trim();
    if (!clean || clean === 'x' || clean.toLowerCase() === 'undefined' || clean.toLowerCase() === 'null') return;

    if (accountId !== clean) {
      accountId = clean;
      accountIdSource = source;
      log('Account ID', accountId, source);
    }
  };

  // --- 2. Passive Detection (Cookie / CLIENT_BOOTSTRAP) ---
  const checkPassiveSources = () => {
    // Cookie for Account ID
    const m = document.cookie.match(/(?:^|;\s*)_account=([^;]+)/);
    if (m) {
      const val = decodeURIComponent(m[1] || '').trim();
      updateAccountId(val, 'Cookie');
    }

    // CLIENT_BOOTSTRAP for User Email and Account ID
    try {
      // https://deepwiki.com/search/unsafewindowlet-bs-unsafewindo_7d2850f6-596f-4cad-8791-de7557543ad6?mode=fast
      let bs = unsafeWindow.CLIENT_BOOTSTRAP;
      console.log(bs);
      console.log('[Cred] CLIENT_BOOTSTRAP inspection:', {
        exists: !!bs,
        source: 'unsafeWindow',
        hasUser: !!bs?.user,
        email: bs?.user?.email,
        session: !!bs?.session
      });

      if (bs) {
        // User Email
        if (bs.user && bs.user.email) {
          updateMainUser(bs.user.email, 'CLIENT_BOOTSTRAP');
        }

        // Session Account ID (fallback)
        if (bs.session && bs.session.account && bs.session.account.id) {
          // We prefer the _account cookie usually, but this is a good source too
          // Only use if we don't have one? Or trust it?
          // Let's use it if we don't have one yet or just update it.
          // Usually _account cookie tracks the *current* workspace. 
          // session.account might be the default one.
          // Let's rely on cookie for *current* workspace ID, 
          // but we can use this for Main User info if needed (though we used user.email above).
        }
      }
    } catch (e) { }
  };

  const updateMainUser = (val: string, source: string) => {
    if (!val) return;
    if (mainUser !== val) {
      mainUser = val;
      log('User', mainUser, source);
    }
  };

  // --- Active Fetching (API) ---

  const getAuthHeaders = (): Headers => {
    const h = new Headers();
    if (token) h.set('authorization', `Bearer ${token}`);
    if (accountId) h.set('chatgpt-account-id', accountId);
    return h;
  };

  const fetchSession = async (): Promise<string | null> => {
    try {
      console.log('[Cred] Attempting to fetch session active...');
      const resp = await fetch('/api/auth/session', { credentials: 'include' });
      if (!resp.ok) {
        lastErr = `session ${resp.status}`;
        console.warn(`[Cred] Session fetch failed: ${resp.status}`);
        return null;
      }
      const data = await resp.json().catch(() => ({}));
      if (data && data.accessToken) {
        return data.accessToken;
      } else {
        console.warn('[Cred] Session fetch returned no accessToken', data);
      }
    } catch (e: any) {
      lastErr = e.message || 'session_error';
      console.error('[Cred] Session fetch error:', e);
    }
    return null;
  };

  const fetchAccountCheck = async (): Promise<string | null> => {
    if (!token) return null;
    const url = `${location.origin}/backend-api/accounts/check/v4-2023-04-27`;
    try {
      const resp = await fetch(url, { headers: getAuthHeaders(), credentials: 'include' });
      if (!resp.ok) return null;
      const data = await resp.json();
      const accounts = data.accounts || {};
      const first = Object.values(accounts).find((a: any) => a?.account?.account_id);
      if (first) return (first as any).account.account_id;
    } catch (e) { }
    return null;
  };

  // --- Public Methods ---

  const ensureViaSession = async (tries = 3): Promise<boolean> => {
    // 1. Check existing
    if (token) {
      // If we have token, ensure we have user profile too
      if (!mainUser) await ensureUserProfile();
      return true;
    }

    // 2. Try Passive (Network/Cookie already running presumably)
    checkPassiveSources();
    if (token) {
      if (!mainUser) await ensureUserProfile();
      return true;
    }

    // 3. Active API
    for (let i = 0; i < tries; i++) {
      const t = await fetchSession();
      if (t) {
        updateToken(t, 'Session API');
        if (!accountId) await ensureAccountId();
        if (!mainUser) await ensureUserProfile();
        return true;
      }
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
    return !!token;
  };

  const ensureUserProfile = async () => {
    // Lazy import to avoid cycle if necessary, or just rely on module resolution
    const { fetchCurrentUser } = await import('./api');
    const user = await fetchCurrentUser();
    if (user && user.email) {
      updateMainUser(user.email, '/backend-api/me');
    }
  };

  const ensureAccountId = async (): Promise<string> => {
    if (accountId) return accountId;

    checkPassiveSources();
    if (accountId) return accountId;

    if (!token) await ensureViaSession(1);
    if (token) {
      const id = await fetchAccountCheck();
      if (id) updateAccountId(id, 'Account API');
    }

    return accountId || '';
  };

  const ensureReady = async (timeout = 10000): Promise<boolean> => {
    // Helper to check if we have all 3 critical pieces
    const isReady = () => !!token && !!mainUser && !!accountId;

    // 1. Fast path
    if (isReady()) return true;

    // 2. Try passive
    checkPassiveSources();
    if (isReady()) return true;

    // 3. Try ensuring via session (active fetch)
    Logger.info('Cred', 'Waiting for credentials readiness (Token + Account + User)...');

    const start = Date.now();

    // Attempt standard ensure sequence
    // This tries 3 times by default
    const p = ensureViaSession();

    // Polling check for success
    while (Date.now() - start < timeout) {
      if (isReady()) return true;
      // Wait a bit
      await new Promise(r => setTimeout(r, 500));
      // Re-check just in case async things settled
    }

    // Wait for the promise to at least settle if it hasnt (though loop handles time)
    await p;

    return isReady();
  };

  const debugText = (): string => {
    const tok = token ? `${mask(token)} (${tokenSource})` : '未获取';
    const acc = accountId ? `${accountId} (${accountIdSource})` : '未获取';
    const usr = mainUser ? `${mainUser}` : '未获取';
    const err = lastErr ? `\n错误：${lastErr}` : '';
    return `Token：${tok}\nAccount：${acc}\nUser: ${usr}${err}`;
  };

  initInterceptors();
  checkPassiveSources();

  return {
    ensureViaSession,
    ensureReady,
    ensureAccountId,
    getAuthHeaders,
    get token() { return token; },
    get accountId() { return accountId; },
    get userLabel() { return mainUser; },
    get debug() { return debugText(); },
  };
})();
