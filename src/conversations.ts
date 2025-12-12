import { Cred } from './cred';
import { fetchConversation } from './api';
import { sleep } from './utils';
import { Project, Task, Conversation } from './types';

export async function listConversationsPage({
  offset = 0,
  limit = 100,
  is_archived,
  is_starred,
  order,
}: {
  offset?: number;
  limit?: number;
  is_archived?: boolean;
  is_starred?: boolean;
  order?: string;
}): Promise<any> {
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

export async function listProjectConversations({
  projectId,
  cursor = 0,
  limit = 50,
}: {
  projectId: string;
  cursor?: number;
  limit?: number;
}): Promise<any> {
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

export async function listGizmosSidebar(cursor?: string | null): Promise<any> {
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

export async function collectAllConversationTasks(
  progressCb?: (pct: number, txt: string) => void
): Promise<{ rootIds: string[]; roots: { id: string; title: string }[]; projects: Project[] }> {
  const rootSet = new Set<string>();
  const rootInfo = new Map<string, { id: string; title: string }>();
  const projectMap = new Map<string, Project>();

  const addRoot = (id: string, title: string) => {
    if (!id) return;
    rootSet.add(id);
    if (!rootInfo.has(id)) rootInfo.set(id, { id, title: title || '' });
  };

  const ensureProject = (projectId: string, projectName?: string): Project | null => {
    if (!projectId) return null;
    let rec = projectMap.get(projectId);
    if (!rec) {
      rec = { projectId, projectName: projectName || '', convs: [] };
      projectMap.set(projectId, rec);
    } else if (projectName && !rec.projectName) {
      rec.projectName = projectName;
    }
    return rec;
  };

  const addProjectConv = (projectId: string, id: string, title: string, projectName?: string) => {
    if (!projectId || !id) return;
    const rec = ensureProject(projectId, projectName);
    if (!rec) return;
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
      arr.forEach((it: any) => {
        if (!it || !it.id) return;
        const id = it.id;
        const projId = it.conversation_template_id || it.gizmo_id || null;
        if (projId) addProjectConv(projId, id, it.title || '');
        else addRoot(id, it.title || '');
      });
      if (progressCb) progressCb(3, `个人会话：${offset + arr.length}${page?.total ? `/${page.total}` : ''}`);
      if (!arr.length || arr.length < limit || (page && page.total !== null && offset + limit >= page.total)) break;
      offset += limit;
      await sleep(120);
    }
  };

  await fetchRootBasic();
  // chatgpt-exporter 模式：不跑星标/归档组合，避免遗漏/重复

  try {
    const projectIds = new Set<string>();
    let cursor: string | null = null;
    do {
      const sidebar: any = await listGizmosSidebar(cursor).catch((e) => {
        console.warn('[ChatGPT-Multimodal-Exporter] gizmos sidebar failed', e);
        return null;
      });
      const gizmosRaw = Array.isArray(sidebar?.gizmos) ? sidebar.gizmos : [];
      const itemsRaw = Array.isArray(sidebar?.items) ? sidebar.items : [];

      const pushGizmo = (g: any) => {
        if (!g || !g.id) return;
        projectIds.add(g.id);
        ensureProject(g.id, g.display?.name || g.name || '');
        const convs = Array.isArray(g.conversations) ? g.conversations : [];
        convs.forEach((c: any) => addProjectConv(g.id, c.id, c.title, g.display?.name || g.name));
      };

      gizmosRaw.forEach((g: any) => pushGizmo(g));

      itemsRaw.forEach((it: any) => {
        const g = it?.gizmo?.gizmo || it?.gizmo || null;
        if (!g || !g.id) return;
        pushGizmo(g);
        const convs = it?.conversations?.items;
        if (Array.isArray(convs))
          convs.forEach((c: any) => addProjectConv(g.id, c.id, c.title, g.display?.name || g.name));
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
        arr.forEach((it: any) => {
          if (!it || !it.id) return;
          addProjectConv(pid, it.id, it.title || '');
        });
        if (progressCb) progressCb(5, `项目 ${pid}：${cursor + arr.length}${page?.total ? `/${page.total}` : ''}`);
        if (!arr.length || arr.length < limit || (page && page.total !== null && cursor + limit >= page.total)) break;
        cursor += limit;
        await sleep(120);
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

export async function scanPagination(
  fetcher: (offsetOrCursor: any, limit: number) => Promise<any>,
  processor: (items: any[]) => Promise<boolean>, // Return false to stop scanning
  initialCursor: any = 0,
  limit = 20
): Promise<void> {
    let cursor = initialCursor;
    while (true) {
        let page;
        try {
            page = await fetcher(cursor, limit);
        } catch (e) {
            console.warn('Pagination fetch failed', e);
            break;
        }

        const items = Array.isArray(page?.items) ? page.items : [];
        if (items.length === 0) break;

        const shouldContinue = await processor(items);
        if (!shouldContinue) break;

        if (typeof cursor === 'number') {
            if (page.total !== undefined && cursor + limit >= page.total) break;
            cursor += limit;
        } else {
            // numeric cursor for projects
            cursor += limit;
        }

        // Safety break if page was not full
        if (items.length < limit) break;
        
        await sleep(100);
    }
}

export async function fetchConvWithRetry(
  id: string,
  projectId?: string | null,
  retries = 2
): Promise<Conversation> {
  let attempt = 0;
  let lastErr: any = null;
  while (attempt <= retries) {
    try {
      return await fetchConversation(id, projectId || undefined);
    } catch (e) {
      lastErr = e;
      attempt++;
      const delay = 400 * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  throw lastErr || new Error('fetch_failed');
}

export async function fetchConversationsBatch(
  tasks: Task[],
  concurrency: number,
  progressCb?: (pct: number, txt: string) => void,
  cancelRef?: { cancel: boolean }
): Promise<(Conversation | null)[]> {
  const total = tasks.length;
  if (!total) return [];
  const results: (Conversation | null)[] = new Array(total);
  let done = 0;
  let index = 0;
  let fatalErr: any = null;

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

