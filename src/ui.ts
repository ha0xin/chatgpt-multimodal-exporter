// @ts-nocheck

import { Cred } from './cred';
import { fetchConversation } from './api';
import { collectAllConversationTasks } from './conversations';
import { collectFileCandidates, extractImages } from './files';
import { downloadSelectedFiles } from './downloads';
import { runBatchExport } from './batchExport';
import { BATCH_CONCURRENCY, U, saveBlob, saveJSON } from './utils';

function showBatchExportDialog() {
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

  let listData = null;
  const selectedSet = new Set();
  let itemCheckboxes = [];
  let groupStates = [];
  const collapsed = new Map();
  const cancelRef = { cancel: false };
  const makeKey = (projectId, id) => `${projectId || 'root'}::${id}`;
  const parseKey = (key) => {
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

  const setStatus = (txt) => {
    status.textContent = txt;
  };
  const setProgress = (pct, txt) => {
    if (pct === 0 && !txt) {
      progWrap.style.display = 'none';
      return;
    }
    progWrap.style.display = 'flex';
    progBar.style.width = `${pct || 0}%`;
    progLabel.textContent = `${txt || ''} ${pct ? `(${pct}%)` : ''}`;
  };

  const getRootsList = (data) => {
    if (data && Array.isArray(data.roots) && data.roots.length) return data.roots;
    if (data && Array.isArray(data.rootIds) && data.rootIds.length)
      return data.rootIds.map((id) => ({ id, title: id }));
    return [];
  };

  const seedSelection = (data) => {
    selectedSet.clear();
    getRootsList(data).forEach((it) => selectedSet.add(makeKey('', it.id)));
    (data.projects || []).forEach((p) => {
      (p.convs || []).forEach((c) => selectedSet.add(makeKey(p.projectId, c.id)));
    });
  };

  const collectAllKeys = (data) => {
    const keys = [];
    getRootsList(data).forEach((it) => keys.push(makeKey('', it.id)));
    (data.projects || []).forEach((p) => {
      (p.convs || []).forEach((c) => keys.push(makeKey(p.projectId, c.id)));
    });
    return keys;
  };

  const renderList = (data) => {
    listWrap.innerHTML = '';
    itemCheckboxes = [];
    groupStates = [];

    const groups = [];
    const rootsList = getRootsList(data);
    if (rootsList.length) groups.push({ label: '无项目（个人会话）', projectId: '', items: rootsList });
    (data.projects || []).forEach((p) => {
      const convs = Array.isArray(p.convs) ? p.convs : [];
      groups.push({
        label: p.projectName || p.projectId || '未命名项目',
        projectId: p.projectId,
        items: convs,
      });
    });



    const addGroup = (label, projectId, items) => {
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
          c.checked = cb.checked;
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
          'data-id': it.id,
          'data-project': projectId || '',
        });
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

    const progressCb = (pct, txt) => setProgress(pct, txt || '');

    const projectMapForTasks = new Map();
    (listData.projects || []).forEach((p) => projectMapForTasks.set(p.projectId, p));
    const seenProj = new Set();
    const selectedProjects = [];
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
    } catch (e) {
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
    } catch (e) {
      console.error('[ChatGPT-Multimodal-Exporter] 拉取列表失败', e);
      setStatus('拉取列表失败');
      alert('拉取列表失败：' + (e && e.message ? e.message : e));
    }
  })();
}

function showFilePreviewDialog(candidates, onConfirm) {
  const overlay = U.ce('div', { className: 'cgptx-modal' });
  const box = U.ce('div', { className: 'cgptx-modal-box' });

  const header = U.ce('div', { className: 'cgptx-modal-header' });
  const title = U.ce('div', {
    className: 'cgptx-modal-title',
    textContent: `可下载文件 (${candidates.length})`,
  });
  const actions = U.ce('div', { className: 'cgptx-modal-actions' });

  const btnClose = U.ce('button', {
    className: 'cgptx-btn',
    textContent: '关闭',
  });
  const btnDownload = U.ce('button', {
    className: 'cgptx-btn primary',
    textContent: '下载选中',
  });
  const btnSelectAll = U.ce('button', {
    className: 'cgptx-btn',
    textContent: '全选/反选',
  });

  actions.append(btnSelectAll, btnDownload, btnClose);
  header.append(title, actions);

  const listEl = U.ce('div', { className: 'cgptx-list' });

  const items = candidates.map((info, idx) => {
    const row = U.ce('div', { className: 'cgptx-item' });
    const checkbox = U.ce('input', {
      type: 'checkbox',
      checked: true,
      'data-idx': idx,
    });
    const body = U.ce('div');
    const name = (info.meta && (info.meta.name || info.meta.file_name)) || info.file_id || info.pointer || '未命名';
    const titleEl = U.ce('div', { className: 'title', textContent: name });
    const metaParts = [];
    metaParts.push(`来源: ${info.source || '未知'}`);
    if (info.file_id) metaParts.push(`file_id: ${info.file_id}`);
    if (info.pointer && info.pointer !== info.file_id) metaParts.push(`pointer: ${info.pointer}`);
    const mime = (info.meta && (info.meta.mime_type || info.meta.file_type)) || (info.meta && info.meta.mime) || '';
    if (mime) metaParts.push(`mime: ${mime}`);
    const size =
      info.meta?.size_bytes || info.meta?.size || info.meta?.file_size || info.meta?.file_size_bytes || null;
    if (size) metaParts.push(`大小: ${U.formatBytes(size)}`);
    const metaEl = U.ce('div', { className: 'meta', textContent: metaParts.join(' • ') });

    body.append(titleEl, metaEl);
    row.append(checkbox, body);
    listEl.append(row);
    return { row, checkbox, info };
  });

  const footer = U.ce('div', {
    className: 'cgptx-modal-actions',
    style: 'justify-content:flex-end;',
  });
  const tip = U.ce('div', {
    className: 'cgptx-chip',
    textContent: '点击“下载选中”将按列表顺序依次下载（含 /files 和 CDN 指针）',
  });
  footer.append(tip);

  box.append(header, listEl, footer);
  overlay.append(box);
  document.body.append(overlay);

  const close = () => overlay.remove();

  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  btnSelectAll.addEventListener('click', () => {
    const allChecked = items.every((i) => i.checkbox.checked);
    items.forEach((i) => (i.checkbox.checked = !allChecked));
  });
  btnDownload.addEventListener('click', () => {
    const selected = items.filter((i) => i.checkbox.checked).map((i) => i.info);
    if (!selected.length) {
      alert('请至少选择一个文件');
      return;
    }
    close();
    onConfirm(selected);
  });
}

let lastConvData = null;

export function mountUI() {
  if (!U.isHostOK()) return;
  if (U.qs('#cgptx-mini-btn')) return;

  const style = U.ce('style', {
    textContent: `
      .cgptx-mini-wrap {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .cgptx-mini-badge {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 999px;
        background: #ffffff;
        color: #374151;
        border: 1px solid #e5e7eb;
        max-width: 260px;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
      }
      .cgptx-mini-badge.ok {
        background: #ecfdf5;
        border-color: #a7f3d0;
        color: #047857;
      }
      .cgptx-mini-badge.bad {
        background: #fef2f2;
        border-color: #fecaca;
        color: #b91c1c;
      }
      .cgptx-mini-btn-row {
        display: flex;
        gap: 8px;
      }
      .cgptx-mini-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 1px solid #e5e7eb;
        cursor: pointer;
        background: #ffffff;
        color: #4b5563;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        transition: all .2s ease;
      }
      .cgptx-mini-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
        color: #2563eb;
        border-color: #bfdbfe;
      }
      .cgptx-mini-btn:disabled {
        opacity: .6;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }
      .cgptx-modal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
      }
      .cgptx-modal-box {
        width: min(840px, 94vw);
        max-height: 85vh;
        background: #ffffff;
        color: #1f2937;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.1);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        overflow: hidden;
        font-size: 14px;
      }
      .cgptx-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #f3f4f6;
      }
      .cgptx-modal-title {
        font-weight: 700;
        font-size: 18px;
        color: #111827;
      }
      .cgptx-modal-actions {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .cgptx-chip {
        padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        color: #4b5563;
        font-size: 13px;
      }
      .cgptx-list {
        flex: 1;
        overflow: auto;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: #f9fafb;
      }
      .cgptx-item {
        display: grid;
        grid-template-columns: 24px 20px 1fr;
        gap: 12px;
        padding: 10px 14px;
        border-bottom: 1px solid #e5e7eb;
        align-items: center;
        background: #fff;
        transition: background .15s;
      }
      .cgptx-item:hover {
        background: #f3f4f6;
      }
      .cgptx-item:last-child {
        border-bottom: none;
      }
      .cgptx-item .title {
        font-weight: 500;
        color: #1f2937;
        line-height: 1.4;
      }
      .cgptx-group {
        border-bottom: 1px solid #e5e7eb;
        background: #fff;
      }
      .cgptx-group:last-child {
        border-bottom: none;
      }
      .cgptx-group-header {
        display: grid;
        grid-template-columns: 24px 20px 1fr auto;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #f3f4f6;
        cursor: pointer;
        user-select: none;
      }
      .cgptx-group-header:hover {
        background: #e5e7eb;
      }
      .cgptx-group-list {
        border-top: 1px solid #e5e7eb;
      }
      .cgptx-arrow {
        font-size: 12px;
        color: #6b7280;
        transition: transform .2s;
      }
      .group-title {
        font-weight: 600;
        color: #374151;
      }
      .group-count {
        color: #6b7280;
        font-size: 12px;
        background: #e5e7eb;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .cgptx-item .meta {
        color: #6b7280;
        font-size: 12px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 2px;
      }
      .cgptx-btn {
        border: 1px solid #d1d5db;
        background: #ffffff;
        color: #374151;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 500;
        transition: all .15s;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      .cgptx-btn:hover {
        background: #f9fafb;
        border-color: #9ca3af;
        color: #111827;
      }
      .cgptx-btn.primary {
        background: #3b82f6;
        border-color: #2563eb;
        color: white;
        box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
      }
      .cgptx-btn.primary:hover {
        background: #2563eb;
      }
      .cgptx-btn:disabled {
        opacity: .5;
        cursor: not-allowed;
        box-shadow: none;
      }
      /* Progress Bar */
      .cgptx-progress-wrap {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
      }
      .cgptx-progress-track {
        height: 8px;
        background: #e5e7eb;
        border-radius: 4px;
        overflow: hidden;
      }
      .cgptx-progress-bar {
        height: 100%;
        background: #3b82f6;
        width: 0%;
        transition: width 0.3s ease;
      }
      .cgptx-progress-text {
        font-size: 12px;
        color: #6b7280;
        text-align: right;
      }
      
      /* Checkbox enhancement */
      input[type="checkbox"] {
        accent-color: #3b82f6;
        width: 16px;
        height: 16px;
        cursor: pointer;
      }
    `,
  });
  document.head.appendChild(style);

  const wrap = U.ce('div', { className: 'cgptx-mini-wrap' });

  const badge = U.ce('div', {
    className: 'cgptx-mini-badge bad',
    id: 'cgptx-mini-badge',
    textContent: '凭证: 未检测',
    title: '尚未尝试获取凭证',
  });

  const row = U.ce('div', { className: 'cgptx-mini-btn-row' });

  const btnJson = U.ce('button', {
    id: 'cgptx-mini-btn',
    className: 'cgptx-mini-btn',
    title: '导出当前对话 JSON',
    textContent: '⬇︎',
  });

  const btnFiles = U.ce('button', {
    id: 'cgptx-mini-btn-files',
    className: 'cgptx-mini-btn',
    title: '下载当前对话中可识别的文件/指针',
    textContent: '📦',
  });

  const btnBatch = U.ce('button', {
    id: 'cgptx-mini-btn-batch',
    className: 'cgptx-mini-btn',
    title: '批量导出 JSON + 附件（可勾选）',
    textContent: '🗂',
  });

  row.append(btnJson, btnFiles, btnBatch);
  wrap.append(badge, row);
  document.body.appendChild(wrap);

  async function refreshCredStatus() {
    await Cred.ensureViaSession();
    await Cred.ensureAccountId();
    const hasToken = !!Cred.token;
    const hasAcc = !!Cred.accountId;
    badge.textContent = `Token: ${hasToken ? '✔' : '✖'} / Account: ${hasAcc ? '✔' : '✖'}`;
    badge.title = Cred.debug;
    badge.classList.remove('ok', 'bad');
    badge.classList.add(hasToken && hasAcc ? 'ok' : 'bad');
  }

  refreshCredStatus();
  setInterval(refreshCredStatus, 60 * 1000);

  btnJson.addEventListener('click', async () => {
    const id = U.convId();
    const pid = U.projectId();
    if (!id) {
      alert('未检测到会话 ID，请在具体对话页面使用（URL 中应包含 /c/xxxx）。');
      return;
    }

    btnJson.disabled = true;
    btnJson.title = '导出中…';

    try {
      await refreshCredStatus();
      if (!Cred.token) throw new Error('没有有效的 accessToken');

      const data = await fetchConversation(id, pid || undefined);
      lastConvData = data;

      extractImages(data);

      const title = U.sanitize(data?.title || '');
      const filename = `${title || 'chat'}_${id}.json`;
      saveJSON(data, filename);
      btnJson.title = '导出完成 ✅（点击可重新导出）';
    } catch (e) {
      console.error('[ChatGPT-Multimodal-Exporter] 导出失败：', e);
      alert('导出失败: ' + (e && e.message ? e.message : e));
      btnJson.title = '导出失败 ❌（点击重试）';
    } finally {
      btnJson.disabled = false;
    }
  });

  btnFiles.addEventListener('click', async () => {
    const id = U.convId();
    const pid = U.projectId();
    if (!id) {
      alert('未检测到会话 ID，请在具体对话页面使用（URL 中应包含 /c/xxxx）。');
      return;
    }

    btnFiles.disabled = true;
    btnFiles.title = '下载文件中…';

    try {
      await refreshCredStatus();
      if (!Cred.token) throw new Error('没有有效的 accessToken');

      let data = lastConvData;
      if (!data || data.conversation_id !== id) {
        data = await fetchConversation(id, pid || undefined);
        lastConvData = data;
      }

      const cands = collectFileCandidates(data);
      if (!cands.length) {
        alert('未找到可下载的文件/指针。');
        btnFiles.title = '未找到文件';
        return;
      }
      showFilePreviewDialog(cands, async (selected) => {
        btnFiles.disabled = true;
        btnFiles.title = `下载中 (${selected.length})…`;
        const res = await downloadSelectedFiles(selected);
        btnFiles.title = `完成 ${res.ok}/${res.total}（可再次点击）`;
        btnFiles.disabled = false;
        alert(`文件下载完成，成功 ${res.ok}/${res.total}，详情见控制台。`);
      });
    } catch (e) {
      console.error('[ChatGPT-Multimodal-Exporter] 下载文件失败：', e);
      alert('下载文件失败: ' + (e && e.message ? e.message : e));
      btnFiles.title = '下载文件失败（点击重试）';
    } finally {
      btnFiles.disabled = false;
    }
  });

  btnBatch.addEventListener('click', async () => {
    btnBatch.disabled = true;
    btnBatch.title = '加载中…';
    try {
      await refreshCredStatus();
      showBatchExportDialog();
    } catch (e) {
      console.error('[ChatGPT-Multimodal-Exporter] 打开批量导出失败', e);
      alert('打开批量导出失败: ' + (e && e.message ? e.message : e));
    } finally {
      btnBatch.disabled = false;
      btnBatch.title = '批量导出 JSON + 附件（可勾选）';
    }
  });
}
