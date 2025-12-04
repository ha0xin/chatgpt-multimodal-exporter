// @ts-nocheck

import { Cred } from './cred';
import { fetchConversation } from './api';
import { U } from './utils';

export async function listConversationsPage({ offset = 0, limit = 100, is_archived, is_starred, order }) {
  if (!Cred.token) await Cred.ensureViaSession();
  const headers = Cred.getAuthHeaders();
  const qs = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  if (typeof is_archived === 'boolean') qs.set('is_archived', String(is_archived));
  if (typeof is_starred === 'boolean') qs.set('is_starred', String(is_starred));
  if (order) qs.set('order', order);
  const url = `${location.origin}/backend-api/conversations?${qs.toString()}`;
  const resp = await fetch(url, { headers, credentials: 'include' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`list convs ${resp.status}: ${txt.slice(0, 120)}`);
  }
  return resp.json();
}

export async function listProjectConversations({ projectId, cursor = 0, limit = 50 }) {
  if (!Cred.token) await Cred.ensureViaSession();
  const headers = Cred.getAuthHeaders();
  const url = `${location.origin}/backend-api/gizmos/${projectId}/conversations?cursor=${cursor}&limit=${limit}`;
  const resp = await fetch(url, { headers, credentials: 'include' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`project convs ${resp.status}: ${txt.slice(0, 120)}`);
  }
  return resp.json();
}

export async function listGizmosSidebar(cursor) {
  if (!Cred.token) await Cred.ensureViaSession();
  const headers = Cred.getAuthHeaders();
  const url = new URL(`${location.origin}/backend-api/gizmos/snorlax/sidebar`);
  url.searchParams.set('conversations_per_gizmo', '0');
  if (cursor) url.searchParams.set('cursor', cursor);
  const resp = await fetch(url.toString(), { headers, credentials: 'include' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`gizmos sidebar ${resp.status}: ${txt.slice(0, 120)}`);
  }
  return resp.json();
}

export async function collectAllConversationTasks(progressCb) {
  const rootSet = new Set();
  const rootInfo = new Map();
  const projectMap = new Map();

  const addRoot = (id, title) => {
    if (!id) return;
    rootSet.add(id);
    if (!rootInfo.has(id)) rootInfo.set(id, { id, title: title || '' });
  };

  const addProjectConv = (projectId, id, title) => {
    if (!projectId || !id) return;
    let rec = projectMap.get(projectId);
    if (!rec) {
      rec = { projectId, projectName: '', createdAt: '', convs: [] };
      projectMap.set(projectId, rec);
    }
    if (!rec.convs.some((x) => x.id === id)) {
      rec.convs.push({ id, title: title || '' });
    }
    if (rootSet.has(id)) {
      rootSet.delete(id);
      rootInfo.delete(id);
    }
  };

  const fetchRootBasic = async () => {
    const limit = 100;
    let offset = 0;
    while (true) {
      const page = await listConversationsPage({ offset, limit }).catch((e) => {
        console.warn('[ChatGPT-Multimodal-Exporter] list conversations failed', e);
        return null;
      });
      const arr = Array.isArray(page?.items) ? page.items : [];
      arr.forEach((it) => {
        if (!it || !it.id) return;
        const id = it.id;
        const projId = it.conversation_template_id || it.gizmo_id || null;
        if (projId) addProjectConv(projId, id, it.title || '');
        else addRoot(id, it.title || '');
      });
      if (progressCb) progressCb(3, `个人会话：${offset + arr.length}${page?.total ? `/${page.total}` : ''}`);
      if (!arr.length || arr.length < limit || (page && page.total !== null && offset + limit >= page.total)) break;
      offset += limit;
      await U.sleep(120);
    }
  };

  await fetchRootBasic();
  // chatgpt-exporter 模式：不跑星标/归档组合，避免遗漏/重复

  try {
    const projectIds = new Set();
    let cursor = null;
    do {
      const sidebar = await listGizmosSidebar(cursor).catch((e) => {
        console.warn('[ChatGPT-Multimodal-Exporter] gizmos sidebar failed', e);
        return null;
      });
      const gizmos = Array.isArray(sidebar?.gizmos) ? sidebar.gizmos : [];
      gizmos.forEach((g) => {
        if (!g || !g.id) return;
        projectIds.add(g.id);
        const convs = Array.isArray(g.conversations) ? g.conversations : [];
        convs.forEach((c) => addProjectConv(g.id, c.id, c.title));
      });
      cursor = sidebar && sidebar.cursor ? sidebar.cursor : null;
    } while (cursor);

    for (const pid of projectIds) {
      let cursor = 0;
      const limit = 50;
      while (true) {
        const page = await listProjectConversations({ projectId: pid, cursor, limit }).catch((e) => {
          console.warn('[ChatGPT-Multimodal-Exporter] project conversations failed', e);
          return null;
        });
        const arr = Array.isArray(page?.items) ? page.items : [];
        arr.forEach((it) => {
          if (!it || !it.id) return;
          addProjectConv(pid, it.id, it.title || '');
        });
        if (progressCb) progressCb(5, `项目 ${pid}：${cursor + arr.length}${page?.total ? `/${page.total}` : ''}`);
        if (!arr.length || arr.length < limit || (page && page.total !== null && cursor + limit >= page.total)) break;
        cursor += limit;
        await U.sleep(120);
      }
    }
  } catch (e) {
    console.warn('[ChatGPT-Multimodal-Exporter] project list error', e);
  }

  const rootIds = Array.from(rootSet);
  const roots = Array.from(rootInfo.values());
  const projects = Array.from(projectMap.values());
  return { rootIds, roots, projects };
}

export async function fetchConvWithRetry(id, projectId, retries = 2) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      return await fetchConversation(id, projectId);
    } catch (e) {
      lastErr = e;
      attempt++;
      const delay = 400 * Math.pow(2, attempt - 1);
      await U.sleep(delay);
    }
  }
  throw lastErr || new Error('fetch_failed');
}

export async function fetchConversationsBatch(tasks, concurrency, progressCb, cancelRef) {
  const total = tasks.length;
  if (!total) return [];
  const results = new Array(total);
  let done = 0;
  let index = 0;
  let fatalErr = null;

  const worker = async () => {
    while (true) {
      if (cancelRef && cancelRef.cancel) return;
      if (fatalErr) return;
      const i = index++;
      if (i >= total) return;
      const t = tasks[i];
      try {
        const data = await fetchConvWithRetry(t.id, t.projectId, 2);
        results[i] = data;
        done++;
        const pct = total ? Math.round((done / total) * 60) + 10 : 10;
        if (progressCb) progressCb(pct, `导出 JSON：${done}/${total}`);
      } catch (e) {
        fatalErr = e;
        return;
      }
    }
  };

  const n = Math.max(1, Math.min(concurrency || 1, total));
  const workers = [];
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  if (fatalErr) throw fatalErr;
  return results;
}
