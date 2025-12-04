import { U, BATCH_CONCURRENCY, saveBlob } from '../../utils';
import { collectAllConversationTasks } from '../../conversations';
import { runBatchExport } from '../../batchExport';
import { Project, Task } from '../../types';

export function showBatchExportDialog() {
    const overlay = U.ce('div', { className: 'cgptx-modal' });
    const box = U.ce('div', { className: 'cgptx-modal-box' });

    const header = U.ce('div', { className: 'cgptx-modal-header' });
    const title = U.ce('div', {
        className: 'cgptx-modal-title',
        textContent: '批量导出对话（JSON + 附件）',
    });

    const actions = U.ce('div', { className: 'cgptx-modal-actions' });
    const btnClose = U.ce('button', { className: 'cgptx-btn', textContent: '关闭' });
    const btnToggle = U.ce('button', { className: 'cgptx-btn', textContent: '全选/反选' });
    const btnStart = U.ce('button', { className: 'cgptx-btn primary', textContent: '开始导出' });
    const btnStop = U.ce('button', { className: 'cgptx-btn', textContent: '停止', disabled: true });
    actions.append(btnToggle, btnStart, btnStop, btnClose);
    header.append(title, actions);

    const status = U.ce('div', { className: 'cgptx-chip', textContent: '加载会话列表…' });
    const opts = U.ce('div', {
        className: 'cgptx-modal-actions',
        style: 'justify-content:flex-start;align-items:center;flex-wrap:wrap;gap:10px;',
    });
    const optAttachLabel = U.ce('label', { style: 'display:flex;align-items:center;gap:6px;' });
    const optAttachments = U.ce('input', { type: 'checkbox', checked: true });
    const optTxt = U.ce('span', { textContent: '包含附件（ZIP）' });
    optAttachLabel.append(optAttachments, optTxt);
    opts.append(optAttachLabel);

    const listWrap = U.ce('div', {
        className: 'cgptx-list',
        style: 'max-height:46vh;overflow:auto;border:1px solid #e5e7eb;border-radius:10px;',
    });

    const progWrap = U.ce('div', { className: 'cgptx-progress-wrap', style: 'display:none' });
    const progTrack = U.ce('div', { className: 'cgptx-progress-track' });
    const progBar = U.ce('div', { className: 'cgptx-progress-bar' });
    const progLabel = U.ce('div', { className: 'cgptx-progress-text' });
    progTrack.append(progBar);
    progWrap.append(progTrack, progLabel);

    box.append(header, status, opts, listWrap, progWrap);
    overlay.append(box);
    document.body.append(overlay);

    const close = () => overlay.remove();
    btnClose.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    let listData: { rootIds: string[]; roots: any[]; projects: Project[] } | null = null;
    const selectedSet = new Set<string>();
    let itemCheckboxes: HTMLInputElement[] = [];
    let groupStates: {
        projectId: string | null;
        items: { id: string; title: string }[];
        headerCb: HTMLInputElement;
        listEl: HTMLElement;
    }[] = [];
    const collapsed = new Map<string | null, boolean>();
    const cancelRef = { cancel: false };
    const makeKey = (projectId: string | null, id: string) => `${projectId || 'root'}::${id}`;
    const parseKey = (key: string): Task => {
        const idx = key.indexOf('::');
        const pid = key.slice(0, idx);
        const id = key.slice(idx + 2);
        return { id, projectId: pid === 'root' ? null : pid };
    };
    const refreshGroupHeaders = () => {
        groupStates.forEach((g) => {
            const keys = g.items.map((it) => makeKey(g.projectId, it.id));
            const selCount = keys.filter((k) => selectedSet.has(k)).length;
            const all = keys.length > 0 && selCount === keys.length;
            const some = selCount > 0 && selCount < keys.length;
            g.headerCb.checked = all;
            g.headerCb.indeterminate = some;
        });
    };

    const setStatus = (txt: string) => {
        status.textContent = txt;
    };
    const setProgress = (pct: number, txt?: string) => {
        if (pct === 0 && !txt) {
            progWrap.style.display = 'none';
            return;
        }
        progWrap.style.display = 'flex';
        progBar.style.width = `${pct || 0}%`;
        progLabel.textContent = `${txt || ''} ${pct ? `(${pct}%)` : ''}`;
    };

    const getRootsList = (data: any) => {
        if (data && Array.isArray(data.roots) && data.roots.length) return data.roots;
        if (data && Array.isArray(data.rootIds) && data.rootIds.length)
            return data.rootIds.map((id: string) => ({ id, title: id }));
        return [];
    };

    const seedSelection = (data: any) => {
        selectedSet.clear();
        getRootsList(data).forEach((it: any) => selectedSet.add(makeKey(null, it.id)));
        (data.projects || []).forEach((p: Project) => {
            (p.convs || []).forEach((c) => selectedSet.add(makeKey(p.projectId, c.id)));
        });
    };

    const collectAllKeys = (data: any) => {
        const keys: string[] = [];
        getRootsList(data).forEach((it: any) => keys.push(makeKey(null, it.id)));
        (data.projects || []).forEach((p: Project) => {
            (p.convs || []).forEach((c) => keys.push(makeKey(p.projectId, c.id)));
        });
        return keys;
    };

    const renderList = (data: any) => {
        listWrap.innerHTML = '';
        itemCheckboxes = [];
        groupStates = [];

        const groups: { label: string; projectId: string | null; items: any[] }[] = [];
        const rootsList = getRootsList(data);
        if (rootsList.length) groups.push({ label: '无项目（个人会话）', projectId: null, items: rootsList });
        (data.projects || []).forEach((p: Project) => {
            const convs = Array.isArray(p.convs) ? p.convs : [];
            groups.push({
                label: p.projectName || p.projectId || '未命名项目',
                projectId: p.projectId,
                items: convs,
            });
        });

        const addGroup = (label: string, projectId: string | null, items: any[]) => {
            const groupWrap = U.ce('div', { className: 'cgptx-group' });
            const header = U.ce('div', { className: 'cgptx-group-header' });
            const arrow = U.ce('span', { className: 'cgptx-arrow', textContent: collapsed.get(projectId) ? '▶' : '▼' });
            const cb = U.ce('input', { type: 'checkbox' });
            const titleEl = U.ce('div', { className: 'group-title', textContent: label });
            const countEl = U.ce('div', { className: 'group-count', textContent: `${items.length} 条` });
            header.append(cb, arrow, titleEl, countEl);
            groupWrap.append(header);

            const list = U.ce('div', {
                className: 'cgptx-group-list',
                style: collapsed.get(projectId) ? 'display:none;' : '',
            });

            const groupObj = { projectId, items, headerCb: cb, listEl: list };
            groupStates.push(groupObj);

            const toggleCollapse = () => {
                const isCollapsed = list.style.display === 'none';
                list.style.display = isCollapsed ? '' : 'none';
                arrow.textContent = isCollapsed ? '▼' : '▶';
            };

            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCollapse();
            });
            titleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCollapse();
            });

            cb.addEventListener('change', () => {
                const keys = items.map((it) => makeKey(projectId, it.id));
                if (cb.indeterminate || !cb.checked) {
                    keys.forEach((k) => selectedSet.delete(k));
                }
                if (cb.checked) {
                    keys.forEach((k) => selectedSet.add(k));
                }
                list.querySelectorAll('input[type="checkbox"]').forEach((c) => {
                    (c as HTMLInputElement).checked = cb.checked;
                });
                refreshGroupHeaders();
                setStatus(`已选 ${selectedSet.size} 条`);
            });

            items.forEach((it) => {
                const row = U.ce('div', { className: 'cgptx-item' });
                const key = makeKey(projectId, it.id);
                const checked = selectedSet.has(key);
                const itemCb = U.ce('input', {
                    type: 'checkbox',
                    checked,
                    defaultChecked: checked,
                });
                itemCb.dataset.id = it.id;
                itemCb.dataset.project = projectId || '';

                itemCb.addEventListener('change', () => {
                    if (itemCb.checked) selectedSet.add(key);
                    else selectedSet.delete(key);
                    refreshGroupHeaders();
                    setStatus(`已选 ${selectedSet.size} 条`);
                });
                const body = U.ce('div');
                const spacer = U.ce('div');
                const titleEl = U.ce('div', { className: 'title', textContent: it.title || it.id });
                body.append(titleEl);
                row.append(itemCb, spacer, body);
                list.append(row);
                itemCheckboxes.push(itemCb);
            });

            refreshGroupHeaders();
            groupWrap.append(list);
            listWrap.append(groupWrap);
        };

        groups.forEach((g) => addGroup(g.label, g.projectId, g.items));
        setStatus(`共 ${groups.reduce((n, g) => n + g.items.length, 0)} 条，已选 ${selectedSet.size}`);
    };

    const toggleAll = () => {
        if (!listData) return;
        const allKeys = collectAllKeys(listData);
        const allChecked = allKeys.every((k) => selectedSet.has(k));
        if (allChecked) {
            allKeys.forEach((k) => selectedSet.delete(k));
        } else {
            allKeys.forEach((k) => selectedSet.add(k));
        }
        renderList(listData);
        setStatus(`已选 ${selectedSet.size} 条`);
    };
    btnToggle.addEventListener('click', toggleAll);

    const startExport = async () => {
        if (!listData) return;
        const tasks = Array.from(selectedSet)
            .map((k) => parseKey(k))
            .filter((t) => !!t.id);
        if (!tasks.length) {
            alert('请至少选择一条会话');
            return;
        }
        cancelRef.cancel = false;
        btnStart.disabled = true;
        btnStop.disabled = false;
        btnToggle.disabled = true;
        setStatus('准备导出…');

        const progressCb = (pct: number, txt: string) => setProgress(pct, txt || '');

        const projectMapForTasks = new Map<string, Project>();
        (listData!.projects || []).forEach((p) => projectMapForTasks.set(p.projectId, p));
        const seenProj = new Set<string>();
        const selectedProjects: Project[] = [];
        tasks.forEach((t) => {
            if (!t.projectId) return;
            if (seenProj.has(t.projectId)) return;
            seenProj.add(t.projectId);
            const p = projectMapForTasks.get(t.projectId);
            if (p) selectedProjects.push(p);
        });
        const selectedRootIds = tasks.filter((t) => !t.projectId).map((t) => t.id);

        try {
            const blob = await runBatchExport({
                tasks,
                projects: selectedProjects,
                rootIds: selectedRootIds,
                includeAttachments: !!optAttachments.checked,
                concurrency: BATCH_CONCURRENCY,
                progressCb,
                cancelRef,
            });
            if (cancelRef.cancel) {
                setStatus('已取消');
                return;
            }
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            saveBlob(blob, `chatgpt-batch-${ts}.zip`);
            setProgress(100, '完成');
            setStatus('完成 ✅（已下载 ZIP）');
        } catch (e: any) {
            console.error('[ChatGPT-Multimodal-Exporter] 批量导出失败', e);
            alert('批量导出失败：' + (e && e.message ? e.message : e));
            setStatus('失败');
        } finally {
            btnStart.disabled = false;
            btnStop.disabled = true;
            btnToggle.disabled = false;
            cancelRef.cancel = false;
        }
    };

    btnStart.addEventListener('click', startExport);
    btnStop.addEventListener('click', () => {
        cancelRef.cancel = true;
        btnStop.disabled = true;
        setStatus('请求取消中…');
    });

    (async () => {
        try {
            const res = await collectAllConversationTasks((pct, text) => setProgress(pct, text));
            listData = res;
            seedSelection(res);
            renderList(res);
            setProgress(100, '加载完成');
            setStatus('请选择要导出的会话');
        } catch (e: any) {
            console.error('[ChatGPT-Multimodal-Exporter] 拉取列表失败', e);
            setStatus('拉取列表失败');
            alert('拉取列表失败：' + (e && e.message ? e.message : e));
        }
    })();
}
