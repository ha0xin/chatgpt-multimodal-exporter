import { U } from '../../utils';
import { FileCandidate } from '../../types';

export function showFilePreviewDialog(candidates: FileCandidate[], onConfirm: (selected: FileCandidate[]) => void) {
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
        });
        checkbox.dataset.idx = String(idx);

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
