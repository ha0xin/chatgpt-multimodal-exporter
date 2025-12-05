import { useState } from 'preact/hooks';
import { toast } from 'sonner';
import { convId, projectId } from '../../utils';
import { Cred } from '../../cred';
import { fetchConversation } from '../../api';
import { collectFileCandidates } from '../../files';
import { downloadSelectedFiles } from '../../downloads';
import { showFilePreviewDialog } from '../dialogs/FilePreviewDialog';

interface DownloadFilesButtonProps {
    refreshCredStatus: () => Promise<void>;
    cachedData: any | null;
    onDataFetched?: (data: any) => void;
}

export function DownloadFilesButton({ refreshCredStatus, cachedData, onDataFetched }: DownloadFilesButtonProps) {
    const [busy, setBusy] = useState(false);
    const [title, setTitle] = useState('下载当前对话中可识别的文件/指针');

    const handleFilesDownload = async () => {
        const id = convId();
        const pid = projectId();
        if (!id) {
            toast.error('未检测到会话 ID，请在具体对话页面使用（URL 中应包含 /c/xxxx）。');
            return;
        }

        setBusy(true);
        setTitle('下载文件中…');

        try {
            await refreshCredStatus();
            if (!Cred.token) throw new Error('没有有效的 accessToken');

            let data = cachedData;
            if (!data || data.conversation_id !== id) {
                data = await fetchConversation(id, pid || undefined);
                if (onDataFetched) onDataFetched(data);
            }

            const cands = collectFileCandidates(data);
            if (!cands.length) {
                toast.info('未找到可下载的文件/指针。');
                setTitle('未找到文件');
                setBusy(false);
                return;
            }

            showFilePreviewDialog(cands, async (selected) => {
                setBusy(true);
                setTitle(`下载中 (${selected.length})…`);

                try {
                    const res = await downloadSelectedFiles(selected);
                    setTitle(`完成 ${res.ok}/${res.total}（可再次点击）`);
                    toast.success(`文件下载完成，成功 ${res.ok}/${res.total}`);
                } catch (e: any) {
                    console.error('[ChatGPT-Multimodal-Exporter] 下载失败：', e);
                    toast.error('下载失败: ' + (e && e.message ? e.message : e));
                    setTitle('下载失败 ❌');
                } finally {
                    setBusy(false);
                }
            });
            setBusy(false);

        } catch (e: any) {
            console.error('[ChatGPT-Multimodal-Exporter] 下载失败：', e);
            toast.error('下载失败: ' + (e && e.message ? e.message : e));
            setTitle('下载失败 ❌');
            setBusy(false);
        }
    };

    return (
        <button
            id="cgptx-mini-btn-files"
            className="cgptx-mini-btn"
            title={title}
            onClick={handleFilesDownload}
            disabled={busy}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
        </button>
    );
}
