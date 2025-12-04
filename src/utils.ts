// @ts-nocheck

import { GM_download, GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client';

export const U = {
  qs: (s, r = document) => r.querySelector(s),
  ce: (t, props = {}, attrs = {}) => {
    const el = document.createElement(t);
    Object.assign(el, props);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  },
  sanitize: (s) => (s || 'untitled').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80),
  isInlinePointer: (p) => {
    if (!p) return false;
    const prefixes = [
      'https://cdn.oaistatic.com/',
      'https://oaidalleapiprodscus.blob.core.windows.net/',
    ];
    return prefixes.some((x) => p.startsWith(x));
  },
  pointerToFileId: (p) => {
    if (!p) return '';
    if (U.isInlinePointer(p)) return p; // already a CDN URL
    const m = p.match(/file[-_][0-9a-f]+/i);
    return m ? m[0] : p;
  },
  fileExtFromMime: (mime) => {
    if (!mime) return '';
    const map = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/markdown': '.md',
    };
    if (map[mime]) return map[mime];
    if (mime.includes('/')) return `.${mime.split('/')[1]}`;
    return '';
  },
  formatBytes: (n) => {
    if (!n || isNaN(n)) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(v >= 10 || v % 1 === 0 ? 0 : 1)}${units[i]}`;
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  // 支持 /c/xxx 和 /g/yyy/c/xxx 两种路径
  convId: () => {
    const p = location.pathname;
    let m = p.match(/^\/c\/([0-9a-f-]+)$/i);
    if (m) return m[1];
    m = p.match(/^\/g\/[^/]+\/c\/([0-9a-f-]+)$/i);
    return m ? m[1] : '';
  },
  projectId: () => {
    const p = location.pathname;
    const m = p.match(/^\/g\/([^/]+)\/c\/[0-9a-f-]+$/i);
    return m ? m[1] : '';
  },
  isHostOK: () => location.host.endsWith('chatgpt.com') || location.host.endsWith('chat.openai.com'),
};

export const BATCH_CONCURRENCY = 4;
export const LIST_PAGE_SIZE = 50;

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = U.ce('a', { href: url });
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  a.remove();
}

export function saveJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: 'application/json',
  });
  saveBlob(blob, filename);
}

export function gmDownload(url, filename) {
  return new Promise((resolve, reject) => {
    GM_download({
      url,
      name: filename || '',
      onload: resolve,
      onerror: reject,
      ontimeout: reject,
    });
  });
}

export function parseMimeFromHeaders(raw) {
  if (!raw) return '';
  const m = raw.match(/content-type:\s*([^\r\n;]+)/i);
  return m ? m[1].trim() : '';
}

export function gmFetchBlob(url, headers) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      method: 'GET',
      headers: headers || {},
      responseType: 'arraybuffer',
      onload: (res) => {
        const mime = parseMimeFromHeaders(res.responseHeaders || '') || '';
        const buf = res.response || res.responseText;
        resolve({ blob: new Blob([buf], { type: mime }), mime });
      },
      onerror: (err) => reject(new Error(err && err.error ? err.error : 'gm_fetch_error')),
      ontimeout: () => reject(new Error('gm_fetch_timeout')),
    });
  });
}
