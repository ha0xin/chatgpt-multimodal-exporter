import { zip, strToU8 } from 'fflate';

import { collectFileCandidates } from './files';
import { downloadPointerOrFileAsBlob } from './downloads';
import { fetchConversationsBatch } from './conversations';
import { sanitize, BATCH_CONCURRENCY } from './utils';
import { Task, Project, BatchExportSummary, Conversation } from './types';

function buildProjectFolderNames(projects: Project[]): Map<string, string> {
  const map = new Map<string, string>();
  const counts: Record<string, number> = {};
  projects.forEach((p) => {
    const base = sanitize(p.projectName || p.projectId || 'project');
    counts[base] = (counts[base] || 0) + 1;
  });
  projects.forEach((p) => {
    let baseName = sanitize(p.projectName || p.projectId || 'project');
    if (counts[baseName] > 1) {
      const stamp = p.createdAt ? p.createdAt.replace(/[^\d]/g, '').slice(0, 14) : '';
      if (stamp) {
        const raw = p.projectName || baseName;
        baseName = sanitize(`${raw}_${stamp}`);
      }
    }
    map.set(p.projectId, baseName || 'project');
  });
  return map;
}

/**
 * recursively ensure path exists in the tree
 */
function ensureFolder(tree: any, parts: string[]) {
  let current = tree;
  for (const part of parts) {
    if (!current[part]) {
      current[part] = {};
    }
    current = current[part];
  }
  return current;
}

export async function runBatchExport({
  tasks,
  projects,
  rootIds,
  includeAttachments = true,
  concurrency = BATCH_CONCURRENCY,
  progressCb,
  cancelRef,
}: {
  tasks: Task[];
  projects: Project[];
  rootIds: string[];
  includeAttachments?: boolean;
  concurrency?: number;
  progressCb?: (pct: number, txt: string) => void;
  cancelRef?: { cancel: boolean };
}): Promise<Blob> {
  if (!tasks || !tasks.length) throw new Error('任务列表为空');

  // We build a tree object for fflate
  // Structure: { "folder": { "file.txt": [Uint8Array, { mtime }] } }
  const zipTree: Record<string, any> = {};

  const summary: BatchExportSummary = {
    exported_at: new Date().toISOString(),
    total_conversations: tasks.length,
    root: { count: rootIds.length, ids: rootIds },
    projects: (projects || []).map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName || '',
      createdAt: p.createdAt || '',
      count: Array.isArray(p.convs) ? p.convs.length : 0,
    })),
    failed: { conversations: [], attachments: [] },
  };

  const folderNameByProjectId = buildProjectFolderNames(projects || []);

  const results = await fetchConversationsBatch(tasks, concurrency, progressCb, cancelRef);
  if (cancelRef && cancelRef.cancel) throw new Error('用户已取消');

  let idxRoot = 0;
  const projSeq: Record<string, number> = {};

  // For timestamp, we use current time.
  // zip attributes expect Date. fflate uses local time components from Date object by default.
  // We use new Date() so files have the export time.


  for (let i = 0; i < tasks.length; i++) {
    if (cancelRef && cancelRef.cancel) throw new Error('用户已取消');
    const t = tasks[i];
    const data = results[i] as Conversation | null;
    
    if (!data) {
      summary.failed.conversations.push({
        id: t.id,
        projectId: t.projectId || '',
        reason: '为空',
      });
      continue;
    }

    // Determine folder path
    const isProject = !!t.projectId;
    const folderParts: string[] = [];

    if (isProject && t.projectId) {
      const fname = folderNameByProjectId.get(t.projectId) || sanitize(t.projectId || 'project');
      folderParts.push(fname);
      
      projSeq[t.projectId] = (projSeq[t.projectId] || 0) + 1;
      const seq = String(projSeq[t.projectId]).padStart(3, '0');
      
      const title = sanitize(data?.title || '');
      const convFolderName = `${seq}_${title || 'chat'}_${t.id}`;
      folderParts.push(convFolderName);
    } else {
      idxRoot++;
      const seq = String(idxRoot).padStart(3, '0');
      const title = sanitize(data?.title || '');
      const convFolderName = `${seq}_${title || 'chat'}_${t.id}`;
      folderParts.push(convFolderName);
    }

    // Get the folder object in the tree
    const convFolder = ensureFolder(zipTree, folderParts);

    // Add conversation.json
    convFolder['conversation.json'] = strToU8(JSON.stringify(data, null, 2));

    const convMeta: import('./types').ConversationMetadata = {
      id: data.conversation_id || t.id,
      title: data.title || '',
      create_time: data.create_time,
      update_time: data.update_time,
      model_slug: data.default_model_slug,
      attachments: [],
      failed_attachments: [],
    };

    if (includeAttachments) {
      const candidates = collectFileCandidates(data).map((x) => ({
        ...x,
        project_id: t.projectId || '',
      }));

      if (candidates.length > 0) {
        // attachments subfolder
        if (!convFolder['attachments']) {
            convFolder['attachments'] = {};
        }
        const attFolder = convFolder['attachments'];
        
        const usedNames = new Set<string>();
        for (const c of candidates) {
          if (cancelRef && cancelRef.cancel) throw new Error('用户已取消');
          const pointerKey = c.pointer || c.file_id || '';
          const originalName = (c.meta && (c.meta.name || c.meta.file_name)) || '';
          let finalName = '';
          try {
            const res = await downloadPointerOrFileAsBlob(c);
            finalName = res.filename || `${sanitize(pointerKey) || 'file'}.bin`;
            if (usedNames.has(finalName)) {
              let cnt = 2;
              while (usedNames.has(`${cnt}_${finalName}`)) cnt++;
              finalName = `${cnt}_${finalName}`;
            }
            usedNames.add(finalName);
            
            // Convert Blob to Uint8Array
            const buf = await res.blob.arrayBuffer();
            attFolder[finalName] = new Uint8Array(buf);

            convMeta.attachments.push({
              pointer: c.pointer || '',
              file_id: c.file_id || '',
              original_name: originalName,
              saved_as: finalName,
              size_bytes: c.meta?.size_bytes || c.meta?.size || c.meta?.file_size || c.meta?.file_size_bytes || null,
              mime: res.mime || c.meta?.mime_type || '',
              source: c.source || '',
            });
          } catch (e: any) {
            const errorMsg = e && e.message ? e.message : String(e);
            convMeta.failed_attachments.push({
              pointer: c.pointer || '',
              file_id: c.file_id || '',
              error: errorMsg,
            });
            summary.failed.attachments.push({
              conversation_id: data.conversation_id || t.id,
              project_id: t.projectId || '',
              pointer: c.pointer || c.file_id || '',
              error: errorMsg,
            });
          }
        }
      }
    }

    // Add metadata.json
    convFolder['metadata.json'] = strToU8(JSON.stringify(convMeta, null, 2));

    if (progressCb) progressCb(80 + Math.round(((i + 1) / tasks.length) * 15), `处理：${i + 1}/${tasks.length}`);
  }

  // Add summary.json to root
  zipTree['summary.json'] = strToU8(JSON.stringify(summary, null, 2));

  if (progressCb) progressCb(98, '压缩中…');

  // Compress
  return new Promise<Blob>((resolve, reject) => {
    zip(zipTree, { level: 6, mem: 8 }, (err, data) => {
        if (err) {
            reject(err);
        } else {
            resolve(new Blob([data as unknown as BlobPart], { type: 'application/zip' }));
        }
    });
  });
}
