import { GM_download, GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client';



export const sanitize = (s: string): string => (s || '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

export const isInlinePointer = (p: string): boolean => {
  if (!p) return false;
  const prefixes = [
    'https://cdn.oaistatic.com/',
    'https://oaidalleapiprodscus.blob.core.windows.net/',
  ];
  return prefixes.some((x) => p.startsWith(x));
};

export const pointerToFileId = (p: string): string => {
  if (!p) return '';
  if (isInlinePointer(p)) return p; // already a CDN URL
  const m = p.match(/file[-_][0-9a-f]+/i);
  return m ? m[0] : p;
};

export const fileExtFromMime = (mime: string): string => {
  if (!mime) return '';
  const map: Record<string, string> = {
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
};

export const formatBytes = (n: number | null | undefined): string => {
  if (!n || isNaN(n)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || v % 1 === 0 ? 0 : 1)}${units[i]}`;
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 支持 /c/xxx 和 /g/yyy/c/xxx 两种路径
export const convId = (): string => {
  const p = location.pathname;
  let m = p.match(/^\/c\/([0-9a-f-]+)$/i);
  if (m) return m[1];
  m = p.match(/^\/g\/[^/]+\/c\/([0-9a-f-]+)$/i);
  return m ? m[1] : '';
};

export const projectId = (): string => {
  const p = location.pathname;
  const m = p.match(/^\/g\/([^/]+)\/c\/[0-9a-f-]+$/i);
  return m ? m[1] : '';
};

export const isHostOK = (): boolean => location.host.endsWith('chatgpt.com') || location.host.endsWith('chat.openai.com');

// Deprecated: U object for backward compatibility during refactor if needed, but we are removing it.
// export const U = { qs, ce, sanitize, isInlinePointer, pointerToFileId, fileExtFromMime, formatBytes, sleep, convId, projectId, isHostOK };

export const BATCH_CONCURRENCY = 4;
export const LIST_PAGE_SIZE = 50;

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  a.remove();
}

export function saveJSON(obj: any, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: 'application/json',
  });
  saveBlob(blob, filename);
}

export function gmDownload(url: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    GM_download({
      url,
      name: filename || '',
      onload: () => resolve(),
      onerror: (err) => reject(err),
      ontimeout: () => reject(new Error('timeout')),
    });
  });
}

export function parseMimeFromHeaders(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/content-type:\s*([^\r\n;]+)/i);
  return m ? m[1].trim() : '';
}

export function gmFetchBlob(url: string, headers?: Record<string, string>): Promise<{ blob: Blob; mime: string }> {
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

const HAS_EXT_RE = /\.[^./\\]+$/;

export function inferFilename(name: string, fallbackId: string, mime: string): string {
  const base = sanitize(name || '') || sanitize(fallbackId || '') || 'untitled';
  const ext = fileExtFromMime(mime || '');
  if (!ext || HAS_EXT_RE.test(base)) return base;
  return `${base}${ext}`;
}

