// @ts-nocheck

import JSZip from 'jszip';

import { collectFileCandidates } from './files';
import { downloadPointerOrFileAsBlob } from './downloads';
import { fetchConversationsBatch } from './conversations';
import { U, BATCH_CONCURRENCY } from './utils';

function buildProjectFolderNames(projects) {
  const map = new Map();
  const counts = {};
  projects.forEach((p) => {
    const base = U.sanitize(p.projectName || p.projectId || 'project');
    counts[base] = (counts[base] || 0) + 1;
  });
  projects.forEach((p) => {
    let baseName = U.sanitize(p.projectName || p.projectId || 'project');
    if (counts[baseName] > 1) {
      const stamp = p.createdAt ? p.createdAt.replace(/[^\d]/g, '').slice(0, 14) : '';
      if (stamp) {
        const raw = p.projectName || baseName;
        baseName = U.sanitize(`${raw}_${stamp}`);
      }
    }
    map.set(p.projectId, baseName || 'project');
  });
  return map;
}

export async function runBatchExport({
  tasks,
  projects,
  rootIds,
  includeAttachments = true,
  concurrency = BATCH_CONCURRENCY,
  progressCb,
  cancelRef,
}) {
  if (!tasks || !tasks.length) throw new Error('任务列表为空');
  if (typeof JSZip === 'undefined') throw new Error('JSZip 未加载');
  const zip = new JSZip();
  const summary = {
    exported_at: new Date().toISOString(),
    total_conversations: tasks.length,
    root: { count: rootIds.length, ids: rootIds },
    projects: (projects || []).map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName || '',
      createdAt: p.createdAt || '',
      count: Array.isArray(p.convs) ? p.convs.length : 0,
    })),
    attachments_map: [],
    failed: { conversations: [], attachments: [] },
  };

  const folderNameByProjectId = buildProjectFolderNames(projects || []);
  const rootJsonFolder = zip.folder('json');
  const rootAttFolder = zip.folder('attachments');
  const projCache = new Map();

  const results = await fetchConversationsBatch(tasks, concurrency, progressCb, cancelRef);
  if (cancelRef && cancelRef.cancel) throw new Error('用户已取消');

  let idxRoot = 0;
  const projSeq = {};

  for (let i = 0; i < tasks.length; i++) {
    if (cancelRef && cancelRef.cancel) throw new Error('用户已取消');
    const t = tasks[i];
    const data = results[i];
    if (!data) {
      summary.failed.conversations.push({
        id: t.id,
        projectId: t.projectId || '',
        reason: '为空',
      });
      continue;
    }
    const isProject = !!t.projectId;
    let baseFolderJson = rootJsonFolder;
    let baseFolderAtt = rootAttFolder;
    let seq = '';
    if (isProject) {
      const fname = folderNameByProjectId.get(t.projectId) || U.sanitize(t.projectId || 'project');
      let cache = projCache.get(t.projectId);
      if (!cache) {
        const rootFolder = zip.folder(`projects/${fname}`);
        cache = {
          json: rootFolder ? rootFolder.folder('json') : null,
          att: rootFolder ? rootFolder.folder('attachments') : null,
        };
        projCache.set(t.projectId, cache);
      }
      baseFolderJson = cache.json || rootJsonFolder;
      baseFolderAtt = cache.att || rootAttFolder;
      projSeq[t.projectId] = (projSeq[t.projectId] || 0) + 1;
      seq = String(projSeq[t.projectId]).padStart(3, '0');
    } else {
      idxRoot++;
      seq = String(idxRoot).padStart(3, '0');
    }

    const title = U.sanitize(data?.title || '');
    const baseName = `${seq}_${title || 'chat'}_${t.id}`;
    const jsonName = `${baseName}.json`;
    if (baseFolderJson) {
      baseFolderJson.file(jsonName, JSON.stringify(data, null, 2));
    } else {
      zip.file(jsonName, JSON.stringify(data, null, 2));
    }

    if (!includeAttachments) {
      if (progressCb) progressCb(80, `写入 JSON：${i + 1}/${tasks.length}`);
      continue;
    }

    const candidates = collectFileCandidates(data).map((x) => ({
      ...x,
      project_id: t.projectId || '',
    }));
    if (!candidates.length) {
      if (progressCb) progressCb(80, `附件：${i + 1}/${tasks.length}（无）`);
      continue;
    }
    const convAttFolder = baseFolderAtt ? baseFolderAtt.folder(baseName) : null;
    const usedNames = new Set();
    for (const c of candidates) {
      if (cancelRef && cancelRef.cancel) throw new Error('用户已取消');
      const pointerKey = c.pointer || c.file_id || '';
      const originalName = (c.meta && (c.meta.name || c.meta.file_name)) || '';
      let finalName = '';
      try {
        const res = await downloadPointerOrFileAsBlob(c);
        finalName = res.filename || `${U.sanitize(pointerKey) || 'file'}.bin`;
        if (usedNames.has(finalName)) {
          let cnt = 2;
          while (usedNames.has(`${cnt}_${finalName}`)) cnt++;
          finalName = `${cnt}_${finalName}`;
        }
        usedNames.add(finalName);
        if (convAttFolder) convAttFolder.file(finalName, res.blob);
        summary.attachments_map.push({
          conversation_id: data.conversation_id || t.id,
          project_id: t.projectId || '',
          pointer: c.pointer || '',
          file_id: c.file_id || '',
          saved_as: finalName,
          source: c.source || '',
          mime: res.mime || c.meta?.mime_type || '',
          original_name: originalName,
          size_bytes:
            c.meta?.size_bytes || c.meta?.size || c.meta?.file_size || c.meta?.file_size_bytes || null,
        });
      } catch (e) {
        summary.failed.attachments.push({
          conversation_id: data.conversation_id || t.id,
          project_id: t.projectId || '',
          pointer: c.pointer || c.file_id || '',
          error: e && e.message ? e.message : String(e),
        });
      }
    }
    if (progressCb) progressCb(80 + Math.round(((i + 1) / tasks.length) * 15), `附件：${i + 1}/${tasks.length}`);
  }

  zip.file('summary.json', JSON.stringify(summary, null, 2));
  if (progressCb) progressCb(98, '压缩中…');
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 7 },
  });
  return blob;
}
