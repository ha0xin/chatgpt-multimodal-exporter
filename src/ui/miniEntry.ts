import { U, saveJSON } from '../utils';
import { Cred } from '../cred';
import { fetchConversation } from '../api';
import { extractImages, collectFileCandidates } from '../files';
import { downloadSelectedFiles } from '../downloads';
import { Conversation } from '../types';
import { showBatchExportDialog } from './dialogs/BatchExportDialog';
import { showFilePreviewDialog } from './dialogs/FilePreviewDialog';

let lastConvData: Conversation | null = null;

export function mountMiniEntry() {
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
        } catch (e: any) {
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
        } catch (e: any) {
            console.error('[ChatGPT-Multimodal-Exporter] 下载失败：', e);
            alert('下载失败: ' + (e && e.message ? e.message : e));
            btnFiles.title = '下载失败 ❌';
        } finally {
            btnFiles.disabled = false;
        }
    });

    btnBatch.addEventListener('click', () => {
        showBatchExportDialog();
    });
}
