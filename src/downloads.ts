import { Cred } from './cred';
import { gmDownload, gmFetchBlob, saveBlob, inferFilename, isInlinePointer, projectId, fileExtFromMime, sanitize } from './utils';
import {
  downloadSandboxFile,
  downloadSandboxFileBlob,
  fetchDownloadUrlOrResponse,
} from './api';
import { FileCandidate, DownloadResult } from './types';

export async function downloadPointerOrFile(fileInfo: FileCandidate): Promise<void> {
  const fileId = fileInfo.file_id;
  const pointer = fileInfo.pointer || '';
  const convId = fileInfo.conversation_id || '';
  const messageId = fileInfo.message_id || '';

  if (isInlinePointer(fileId) || isInlinePointer(pointer)) {
    const url = isInlinePointer(pointer) ? pointer : fileId;
    const name = inferFilename(
      (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) || '',
      fileId || pointer,
      ''
    );
    await gmDownload(url, name);
    return;
  }

  if (pointer && pointer.startsWith('sandbox:')) {
    if (!convId || !messageId) {
      console.warn('[ChatGPT-Multimodal-Exporter] sandbox pointer缺少 conversation/message id', pointer);
      return;
    }
    await downloadSandboxFile({ conversationId: convId, messageId, sandboxPath: pointer });
    return;
  }

  if (!fileId.startsWith('file-') && !fileId.startsWith('file_')) {
      console.warn("Invalid file_id, expected to start with 'file-' or 'file_'", fileId);
      return;
  }

  if (!Cred.token) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('没有 accessToken，无法下载文件');
  }
  const headers = Cred.getAuthHeaders();
  const pid = projectId();
  if (pid) headers.set('chatgpt-project-id', pid);

  const downloadResult = await fetchDownloadUrlOrResponse(fileId, headers, fileInfo.gizmo_id);
  let resp: Response;
  if (downloadResult instanceof Response) {
    resp = downloadResult;
  } else if (typeof downloadResult === 'string') {
    const fname =
      (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) ||
      `${fileId}${fileExtFromMime('') || ''}`;
    await gmDownload(downloadResult, fname);
    return;
  } else {
    throw new Error(`无法获取 download_url，如果file-id正确，可能是链接过期 (file_id: ${fileId})`);
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`下载失败 ${resp.status}: ${txt.slice(0, 120)}`);
  }

  const blob = await resp.blob();
  const cd = resp.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
  const mime =
    (fileInfo.meta && (fileInfo.meta.mime_type || fileInfo.meta.file_type)) ||
    resp.headers.get('Content-Type') ||
    '';
  const ext = fileExtFromMime(mime) || '.bin';
  let name =
    (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) ||
    (m && decodeURIComponent(m[1])) ||
    `${fileId}${ext}`;
  name = sanitize(name);
  saveBlob(blob, name);
}

export async function downloadSelectedFiles(list: FileCandidate[]): Promise<DownloadResult> {
  let okCount = 0;
  for (const info of list) {
    try {
      await downloadPointerOrFile(info);
      okCount++;
    } catch (e) {
      console.error('[ChatGPT-Multimodal-Exporter] 下载失败', info, e);
    }
  }
  return { ok: okCount, total: list.length };
}

export async function downloadPointerOrFileAsBlob(
  fileInfo: FileCandidate
): Promise<{ blob: Blob; mime: string; filename: string }> {
  const fileId = fileInfo.file_id;
  const pointer = fileInfo.pointer || '';
  const convId = fileInfo.conversation_id || '';
  const projectId = fileInfo.project_id || '';
  const messageId = fileInfo.message_id || '';

  if (isInlinePointer(fileId) || isInlinePointer(pointer)) {
    const url = isInlinePointer(pointer) ? pointer : fileId;
    const res = await gmFetchBlob(url);
    const mime = res.mime || fileInfo.meta?.mime_type || fileInfo.meta?.mime || '';
    const filename = inferFilename(
      (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) || '',
      fileId || pointer,
      mime
    );
    return { blob: res.blob, mime, filename };
  }

  if (pointer && pointer.startsWith('sandbox:')) {
    if (!convId || !messageId) throw new Error('sandbox pointer 缺少 conversation/message id');
    return downloadSandboxFileBlob({ conversationId: convId, messageId, sandboxPath: pointer });
  }

  if (!fileId.startsWith('file-') && !fileId.startsWith('file_')) {
      console.warn("Invalid file_id, expected to start with 'file-' or 'file_'", fileId);
      throw new Error("Invalid file_id");
  }

  if (!Cred.token) {
    const ok = await Cred.ensureViaSession();
    if (!ok) throw new Error('没有 accessToken，无法下载文件');
  }
  const headers = Cred.getAuthHeaders();
  if (projectId) headers.set('chatgpt-project-id', projectId);

  const downloadResult = await fetchDownloadUrlOrResponse(fileId, headers, fileInfo.gizmo_id);
  let resp: Response;
  if (downloadResult instanceof Response) {
    resp = downloadResult;
  } else if (typeof downloadResult === 'string') {
    const res = await gmFetchBlob(downloadResult);
    const mime = res.mime || fileInfo.meta?.mime_type || fileInfo.meta?.mime || '';
    const fname = inferFilename(
      (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) || '',
      fileId,
      mime
    );
    return {
      blob: res.blob,
      mime,
      filename: fname,
    };
  } else {
    throw new Error(`无法获取 download_url，如果file-id正确，可能是链接过期 (file_id: ${fileId})`);
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`下载失败 ${resp.status}: ${txt.slice(0, 120)}`);
  }

  const blob = await resp.blob();
  const cd = resp.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
  const mime =
    (fileInfo.meta && (fileInfo.meta.mime_type || fileInfo.meta.file_type)) ||
    resp.headers.get('Content-Type') ||
    '';
  const name = inferFilename(
    (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) || (m && decodeURIComponent(m[1])) || '',
    fileId,
    mime
  );
  return { blob, mime, filename: name };
}

