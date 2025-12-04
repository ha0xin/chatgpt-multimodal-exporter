// @ts-nocheck

export const Cred = (() => {
  let token = null;
  let accountId = null;
  let lastErr = '';
  let triedAccountApi = false;

  const mask = (s, keepL = 8, keepR = 4) => {
    if (!s) return '';
    if (s.length <= keepL + keepR) return s;
    return `${s.slice(0, keepL)}…${s.slice(-keepR)}`;
  };

  const parseAccountCookie = () => {
    const m = document.cookie.match(/(?:^|;\s*)_account=([^;]+)/);
    if (!m) return '';
    const val = decodeURIComponent(m[1] || '').trim();
    if (!val || val === 'x' || val === 'undefined' || val === 'null') return '';
    return val;
  };

  const getAuthHeaders = () => {
    const h = new Headers();
    if (token) h.set('authorization', `Bearer ${token}`);
    if (accountId) h.set('chatgpt-account-id', accountId);
    return h;
  };

  const fetchAccountFromApi = async () => {
    if (!token) return '';
    const url = `${location.origin}/backend-api/accounts/check/v4-2023-04-27`;
    const resp = await fetch(url, { headers: getAuthHeaders(), credentials: 'include' }).catch(() => null);
    if (!resp || !resp.ok) return '';
    const data = await resp.json().catch(() => null);
    if (!data || typeof data !== 'object') return '';
    const accounts = data.accounts || {};
    const ordering = Array.isArray(data.account_ordering) ? data.account_ordering : [];
    for (const key of ordering) {
      const a = accounts[key];
      const aid = a?.account?.account_id;
      if (aid) return aid;
    }
    const first = Object.values(accounts).find((a) => a?.account?.account_id);
    return first ? first.account.account_id : '';
  };

  const ensureViaSession = async (tries = 3) => {
    for (let i = 0; i < tries; i++) {
      try {
        const resp = await fetch('/api/auth/session', {
          credentials: 'include',
        });
        if (!resp.ok) {
          lastErr = `session ${resp.status}`;
          } else {
            const j = await resp.json().catch(() => ({}));
            if (j && j.accessToken) {
              token = j.accessToken;
              lastErr = '';
            }
          }
          if (!accountId) {
            const fromCookie = parseAccountCookie();
            if (fromCookie) accountId = fromCookie;
          }
          if (token) return true;
        } catch (e) {
          lastErr = e && e.message ? e.message : 'session_error';
        }
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
    return !!token;
  };

  const ensureAccountId = async () => {
    if (accountId && accountId !== 'x') return accountId;
    const fromCookie = parseAccountCookie();
    if (fromCookie) {
      accountId = fromCookie;
      return accountId;
    }
    if (triedAccountApi) return accountId || '';
    triedAccountApi = true;
    const apiId = await fetchAccountFromApi();
    if (apiId) accountId = apiId;
    return accountId || '';
  };

  const debugText = () => {
    const tok = token ? mask(token) : '未获取';
    const acc = accountId || '未获取';
    const err = lastErr ? `\n错误：${lastErr}` : '';
    return `Token：${tok}\nAccount：${acc}${err}`;
  };

  return {
    ensureViaSession,
    ensureAccountId,
    getAuthHeaders,
    get token() {
      return token;
    },
    get accountId() {
      return accountId;
    },
    get debug() {
      return debugText();
    },
  };
})();
