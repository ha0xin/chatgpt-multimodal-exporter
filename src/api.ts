import { Cred } from './cred';
import { projectId, sanitize, gmDownload, gmFetchBlob, inferFilename, fetchWithRetry } from './utils';
import { Conversation, UserProfile } from './types';

export async function fetchConversation(id: string, projectId?: string): Promise<Conversation> {
  if (!Cred.token) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('无法获取登录凭证（accessToken）');
  }

  const headers = Cred.getAuthHeaders();
  if (projectId) headers.set('chatgpt-project-id', projectId);

  const url = `${location.origin}/backend-api/conversation/${id}`;
  const init: RequestInit = {
    method: 'GET',
    credentials: 'include',
    headers,
  };

  // Use fetchWithRetry for the initial request
  let resp = await fetchWithRetry(url, init).catch(() => null);
  if (!resp) throw new Error('网络错误');

  if (resp.status === 401) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('401：重新获取凭证失败');
    const h2 = Cred.getAuthHeaders();
    if (projectId) h2.set('chatgpt-project-id', projectId);
    init.headers = h2;
    // Retry with new token, also using fetchWithRetry
    resp = await fetchWithRetry(url, init).catch(() => null);
    if (!resp) throw new Error('网络错误（重试）');
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  return resp.json();
}

export async function downloadSandboxFile({
  conversationId,
  messageId,
  sandboxPath,
}: {
  conversationId: string;
  messageId: string;
  sandboxPath: string;
}): Promise<void> {
  if (!Cred.token) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('没有 accessToken，无法下载 sandbox 文件');
  }
  const headers = Cred.getAuthHeaders();
  const pid = projectId();
  if (pid) headers.set('chatgpt-project-id', pid);

  const params = new URLSearchParams({
    message_id: messageId,
    sandbox_path: sandboxPath.replace(/^sandbox:/, ''),
  });
  const url = `${location.origin}/backend-api/conversation/${conversationId}/interpreter/download?${params.toString()}`;
  const resp = await fetchWithRetry(url, { headers, credentials: 'include' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`sandbox download meta ${resp.status}: ${txt.slice(0, 200)}`);
  }
  let j: any;
  try {
    j = await resp.json();
  } catch (e) {
    throw new Error('sandbox download meta 非 JSON');
  }
  const dl = j.download_url;
  if (!dl) throw new Error(`sandbox download_url 缺失: ${JSON.stringify(j).slice(0, 200)}`);
  const fname = sanitize(j.file_name || sandboxPath.split('/').pop() || 'sandbox_file');
  await gmDownload(dl, fname);
}

export async function downloadSandboxFileBlob({
  conversationId,
  messageId,
  sandboxPath,
}: {
  conversationId: string;
  messageId: string;
  sandboxPath: string;
}): Promise<{ blob: Blob; mime: string; filename: string }> {
  if (!Cred.token) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('没有 accessToken，无法下载 sandbox 文件');
  }
  const headers = Cred.getAuthHeaders();
  const pid = projectId();
  if (pid) headers.set('chatgpt-project-id', pid);

  const params = new URLSearchParams({
    message_id: messageId,
    sandbox_path: sandboxPath.replace(/^sandbox:/, ''),
  });
  const url = `${location.origin}/backend-api/conversation/${conversationId}/interpreter/download?${params.toString()}`;
  const resp = await fetchWithRetry(url, { headers, credentials: 'include' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`sandbox download meta ${resp.status}: ${txt.slice(0, 200)}`);
  }
  let j: any;
  try {
    j = await resp.json();
  } catch (e) {
    throw new Error('sandbox download meta 非 JSON');
  }
  const dl = j.download_url;
  if (!dl) throw new Error(`sandbox download_url 缺失: ${JSON.stringify(j).slice(0, 200)}`);
  const gmHeaders = {};
  const res = await gmFetchBlob(dl, gmHeaders);
  const fname = inferFilename(
    j.file_name || sandboxPath.split('/').pop() || 'sandbox_file',
    sandboxPath,
    res.mime || ''
  );
  return { blob: res.blob, mime: res.mime || '', filename: fname };
}

export async function fetchFileMeta(fileId: string, headers: Headers): Promise<any> {
  const url = `${location.origin}/backend-api/files/${fileId}`;
  const resp = await fetchWithRetry(url, { method: 'GET', headers, credentials: 'include' });
  if (!resp.ok) throw new Error(`meta ${resp.status}`);
  return resp.json();
}

export async function fetchDownloadUrlOrResponse(
  fileId: string,
  headers: Headers
): Promise<string | Response | null> {
  const url = `${location.origin}/backend-api/files/download/${fileId}?inline=false`;
  const resp = await fetchWithRetry(url, { method: 'GET', headers, credentials: 'include' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`download meta ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const j = await resp.json();
    if (!j.download_url && !j.url) {
      throw new Error(`download meta missing url: ${JSON.stringify(j).slice(0, 200)}`);
    }
    return j.download_url || j.url;
  }
  return resp;
}

export async function fetchCurrentUser(): Promise<UserProfile | null> {
  if (!Cred.token) return null;
  const url = `${location.origin}/backend-api/me`;
  const headers = Cred.getAuthHeaders();
  try {
    const resp = await fetchWithRetry(url, { method: 'GET', headers, credentials: 'include' });
    if (!resp.ok) {
      console.warn('fetchCurrentUser failed', resp.status);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.error('fetchCurrentUser error', e);
    return null;
  }
}

