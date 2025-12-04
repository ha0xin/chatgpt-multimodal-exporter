// @ts-nocheck

import { Cred } from './cred';
import { U, gmDownload, gmFetchBlob, inferFilename } from './utils';

export async function fetchConversation(id, projectId) {
  if (!Cred.token) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('无法获取登录凭证（accessToken）');
  }

  const headers = Cred.getAuthHeaders();
  if (projectId) headers.set('chatgpt-project-id', projectId);

  const url = `${location.origin}/backend-api/conversation/${id}`;
  const init = {
    method: 'GET',
    credentials: 'include',
    headers,
  };

  let resp = await fetch(url, init).catch(() => null);
  if (!resp) throw new Error('网络错误');
  if (resp.status === 401) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('401：重新获取凭证失败');
    const h2 = Cred.getAuthHeaders();
    if (projectId) h2.set('chatgpt-project-id', projectId);
    init.headers = h2;
    resp = await fetch(url, init).catch(() => null);
    if (!resp) throw new Error('网络错误（重试）');
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 120)}`);
  }
  return resp.json();
}

export async function downloadSandboxFile({ conversationId, messageId, sandboxPath }) {
  if (!Cred.token) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('没有 accessToken，无法下载 sandbox 文件');
  }
  const headers = Cred.getAuthHeaders();
  const pid = U.projectId();
  if (pid) headers.set('chatgpt-project-id', pid);

  const params = new URLSearchParams({
    message_id: messageId,
    sandbox_path: sandboxPath.replace(/^sandbox:/, ''),
  });
  const url = `${location.origin}/backend-api/conversation/${conversationId}/interpreter/download?${params.toString()}`;
  const resp = await fetch(url, { headers, credentials: 'include' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`sandbox download meta ${resp.status}: ${txt.slice(0, 120)}`);
  }
  let j;
  try {
    j = await resp.json();
  } catch (e) {
    throw new Error('sandbox download meta 非 JSON');
  }
  const dl = j.download_url;
  if (!dl) throw new Error('sandbox download_url 缺失');
  const fname = U.sanitize(j.file_name || sandboxPath.split('/').pop() || 'sandbox_file');
  await gmDownload(dl, fname);
}

export async function downloadSandboxFileBlob({ conversationId, messageId, sandboxPath }) {
  if (!Cred.token) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('没有 accessToken，无法下载 sandbox 文件');
  }
  const headers = Cred.getAuthHeaders();
  const pid = U.projectId();
  if (pid) headers.set('chatgpt-project-id', pid);

  const params = new URLSearchParams({
    message_id: messageId,
    sandbox_path: sandboxPath.replace(/^sandbox:/, ''),
  });
  const url = `${location.origin}/backend-api/conversation/${conversationId}/interpreter/download?${params.toString()}`;
  const resp = await fetch(url, { headers, credentials: 'include' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`sandbox download meta ${resp.status}: ${txt.slice(0, 120)}`);
  }
  let j;
  try {
    j = await resp.json();
  } catch (e) {
    throw new Error('sandbox download meta 非 JSON');
  }
  const dl = j.download_url;
  if (!dl) throw new Error('sandbox download_url 缺失');
  const gmHeaders = {};
  const res = await gmFetchBlob(dl, gmHeaders);
  const fname = inferFilename(j.file_name || sandboxPath.split('/').pop() || 'sandbox_file', sandboxPath, res.mime || '');
  return { blob: res.blob, mime: res.mime || '', filename: fname };
}

export async function fetchFileMeta(fileId, headers) {
  const url = `${location.origin}/backend-api/files/${fileId}`;
  const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
  if (!resp.ok) throw new Error(`meta ${resp.status}`);
  return resp.json();
}

export async function fetchDownloadUrlOrResponse(fileId, headers) {
  const url = `${location.origin}/backend-api/files/download/${fileId}?inline=false`;
  const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
  if (!resp.ok) throw new Error(`download meta ${resp.status}`);
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const j = await resp.json();
    return j.download_url || j.url || null;
  }
  return resp;
}
