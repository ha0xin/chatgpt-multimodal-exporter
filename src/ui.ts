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
    style: 'justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;',
  });
  const optAttachLabel = U.ce('label', { style: 'display:flex;align-items:center;gap:6px;' });
  const optAttachments = U.ce('input', { type: 'checkbox', checked: true });
  const optTxt = U.ce('span', { textContent: '包含附件（ZIP）' });
  optAttachLabel.append(optAttachments, optTxt);
  const projectWrap = U.ce('div', { style: 'display:flex;align-items:center;gap:8px;' });
  const projectLabel = U.ce('span', { textContent: '项目筛选：' });
  const projectSelect = U.ce('select', {
    style:
      'background:#0b1220;border:1px solid #1f2937;color:#e5e7eb;padding:6px 10px;border-radius:10px;min-width:160px;',
  });
  projectWrap.append(projectLabel, projectSelect);
  opts.append(projectWrap, optAttachLabel);

  const listWrap = U.ce('div', {
    className: 'cgptx-list',
    style: 'max-height:46vh;overflow:auto;border:1px solid #1f2937;border-radius:10px;',
  });

  const progText = U.ce('div', { className: 'cgptx-chip', textContent: '' });

  box.append(header, status, opts, listWrap, progText);
  overlay.append(box);
  document.body.append(overlay);

  const close = () => overlay.remove();
  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  let listData = null;
  let currentProjectId = '';
  const selectedSet = new Set();
  let checkboxes = [];
  const cancelRef = { cancel: false };
  const makeKey = (projectId, id) => `${projectId || 'root'}::${id}`;
  const parseKey = (key) => {
    const idx = key.indexOf('::');
    const pid = key.slice(0, idx);
    const id = key.slice(idx + 2);
    return { id, projectId: pid === 'root' ? null : pid };
  };

  const setStatus = (txt) => {
    status.textContent = txt;
  };
  const setProgress = (pct, txt) => {
    progText.textContent = `${txt || ''} ${pct ? `(${pct}%)` : ''}`;
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

  const renderList = (data) => {
    listWrap.innerHTML = '';
    checkboxes = [];
    const rootsList = getRootsList(data);
    const project = (data.projects || []).find((p) => p.projectId === currentProjectId);
    const items = currentProjectId ? project?.convs || [] : rootsList;
    const renderItems = items && items.length ? items : [];
    renderItems.forEach((it) => {
      const row = U.ce('div', { className: 'cgptx-item' });
      const key = makeKey(currentProjectId, it.id);
      const checked = selectedSet.has(key);
      const cb = U.ce('input', {
        type: 'checkbox',
        checked,
        defaultChecked: checked,
        'data-id': it.id,
        'data-project': currentProjectId || '',
      });
      cb.addEventListener('change', () => {
        if (cb.checked) selectedSet.add(key);
        else selectedSet.delete(key);
      });
      const body = U.ce('div');
      const titleEl = U.ce('div', { className: 'title', textContent: it.title || it.id });
      body.append(titleEl);
      row.append(cb, body);
      listWrap.append(row);
      checkboxes.push(cb);
    });
    const projectName =
      currentProjectId && project ? project.projectName || project.projectId : '无项目（个人会话）';
    setStatus(`已加载：${projectName} - ${renderItems.length} 条`);
  };

  const toggleAll = () => {
    if (!checkboxes.length) return;
    const allChecked = checkboxes.every((c) => c.checked);
    checkboxes.forEach((c) => {
      c.checked = !allChecked;
      const key = makeKey(c.getAttribute('data-project') || '', c.getAttribute('data-id') || '');
      if (c.checked) selectedSet.add(key);
      else selectedSet.delete(key);
    });
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
    const selectedProjects = tasks
      .map((t) => t.projectId)
      .filter((pid) => !!pid)
      .map((pid) => projectMapForTasks.get(pid))
      .filter(Boolean);
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
      projectSelect.innerHTML = '';
      const optionRoot = U.ce('option', { value: '', textContent: '无项目（个人会话）' });
      projectSelect.append(optionRoot);
      (res.projects || []).forEach((p) => {
        const name = p.projectName || p.projectId || '未命名项目';
        const opt = U.ce('option', { value: p.projectId, textContent: name });
        projectSelect.append(opt);
      });
      projectSelect.addEventListener('change', () => {
        currentProjectId = projectSelect.value;
        renderList(listData);
      });
      currentProjectId = '';
      projectSelect.value = '';
      renderList(res);
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
        gap: 4px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .cgptx-mini-badge {
        font-size: 11px;
        padding: 3px 6px;
        border-radius: 999px;
        background: #f3f4f6;
        color: #374151;
        border: 1px solid #e5e7eb;
        max-width: 260px;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .cgptx-mini-badge.ok {
        background: #e8f7ee;
        border-color: #b7e3c9;
        color: #065f46;
      }
      .cgptx-mini-badge.bad {
        background: #fef2f2;
        border-color: #fecaca;
        color: #b91c1c;
      }
      .cgptx-mini-btn-row {
        display: flex;
        gap: 6px;
      }
      .cgptx-mini-btn {
        width: 46px;
        height: 46px;
        border-radius: 999px;
        border: none;
        cursor: pointer;
        background: #111827;
        color: #fff;
        box-shadow: 0 8px 22px rgba(0, 0, 0, .22);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        transition: transform .15s, opacity .15s;
        opacity: .95;
      }
      .cgptx-mini-btn:hover {
        transform: translateY(-1px);
        opacity: 1;
      }
      .cgptx-mini-btn:disabled {
        opacity: .5;
        cursor: not-allowed;
        transform: none;
      }
      .cgptx-modal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.35);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
      }
      .cgptx-modal-box {
        width: min(840px, 94vw);
        max-height: 80vh;
        background: #111827;
        color: #e5e7eb;
        border: 1px solid #1f2937;
        border-radius: 14px;
        box-shadow: 0 20px 40px rgba(0,0,0,.35);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow: hidden;
        font-size: 14px;
      }
      .cgptx-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .cgptx-modal-title {
        font-weight: 600;
        font-size: 16px;
      }
      .cgptx-modal-actions {
        display: flex;
        gap: 8px;
      }
      .cgptx-chip {
        padding: 4px 8px;
        border-radius: 8px;
        border: 1px solid #1f2937;
        background: #0b1220;
        color: #9ca3af;
      }
      .cgptx-list {
        flex: 1;
        overflow: auto;
        border: 1px solid #1f2937;
        border-radius: 10px;
        background: #0b1220;
      }
      .cgptx-item {
        display: grid;
        grid-template-columns: 22px 1fr;
        gap: 8px;
        padding: 6px 10px;
        border-bottom: 1px solid #1f2937;
        align-items: center;
      }
      .cgptx-item:last-child {
        border-bottom: none;
      }
      .cgptx-item .title {
        font-weight: 600;
        color: #f3f4f6;
        line-height: 1.35;
      }
      .cgptx-item .meta {
        color: #9ca3af;
        font-size: 12px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .cgptx-btn {
        border: 1px solid #1f2937;
        background: #111827;
        color: #e5e7eb;
        padding: 8px 12px;
        border-radius: 10px;
        cursor: pointer;
      }
      .cgptx-btn.primary {
        background: #2563eb;
        border-color: #1d4ed8;
        color: white;
      }
      .cgptx-btn:disabled {
        opacity: .5;
        cursor: not-allowed;
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
