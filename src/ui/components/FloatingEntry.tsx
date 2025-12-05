import { useState, useEffect, useRef } from 'preact/hooks';
import { convId, projectId, sanitize, saveJSON } from '../../utils';
import { Cred } from '../../cred';
import { fetchConversation } from '../../api';
import { extractImages, collectFileCandidates } from '../../files';
import { downloadSelectedFiles } from '../../downloads';
import { Conversation } from '../../types';
import { showBatchExportDialog } from '../dialogs/BatchExportDialog';
import { showFilePreviewDialog } from '../dialogs/FilePreviewDialog';
import { toast } from 'sonner';
import { subscribeStatus, getRootHandle, startAutoSaveLoop, AutoSaveStatus } from '../../autoSave';
import { AutoSaveSettings } from './AutoSaveSettings';

export function FloatingEntry() {
  const [status, setStatus] = useState({ hasToken: false, hasAcc: false, debug: '' });
  const [jsonBusy, setJsonBusy] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const [jsonTitle, setJsonTitle] = useState('导出当前对话 JSON');
  const [filesTitle, setFilesTitle] = useState('下载当前对话中可识别的文件/指针');
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>({ lastRun: 0, state: 'idle', message: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [workspaceInfo, setWorkspaceInfo] = useState('Checking...');

  const lastConvData = useRef<Conversation | null>(null);

  const refreshCredStatus = async () => {
    await Cred.ensureViaSession();
    await Cred.ensureAccountId();
    setStatus({
      hasToken: !!Cred.token,
      hasAcc: !!Cred.accountId,
      debug: Cred.debug
    });
  };

  useEffect(() => {
    refreshCredStatus();
    const timer = setInterval(refreshCredStatus, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Auto-start loop if handle exists
    getRootHandle().then(h => {
      if (h) startAutoSaveLoop();
    });
    return subscribeStatus(setAutoSaveStatus);
  }, []);

  useEffect(() => {
    const updateWs = () => {
      // Only update if we have confirmed account status
      if (!status.hasAcc) {
        setWorkspaceInfo('Checking...');
        return;
      }

      const acc = Cred.accountId;
      if (!acc || acc === 'x') {
        setWorkspaceInfo('Personal');
      } else {
        setWorkspaceInfo(`Workspace id: ${acc.slice(0, 8)}...`);
      }
    };
    updateWs();
  }, [status.hasAcc]); // Depend on status.hasAcc

  const handleJsonExport = async () => {
    const id = convId();
    const pid = projectId();
    if (!id) {
      toast.error('未检测到会话 ID，请在具体对话页面使用（URL 中应包含 /c/xxxx）。');
      return;
    }

    setJsonBusy(true);
    setJsonTitle('导出中…');

    try {
      await refreshCredStatus();
      if (!Cred.token) throw new Error('没有有效的 accessToken');

      const data = await fetchConversation(id, pid || undefined);
      lastConvData.current = data;

      extractImages(data);

      const title = sanitize(data?.title || '');
      const filename = `${title || 'chat'}_${id}.json`;
      saveJSON(data, filename);
      setJsonTitle('导出完成 ✅（点击可重新导出）');
      toast.success('导出 JSON 完成');
    } catch (e: any) {
      console.error('[ChatGPT-Multimodal-Exporter] 导出失败：', e);
      toast.error('导出失败: ' + (e && e.message ? e.message : e));
      setJsonTitle('导出失败 ❌（点击重试）');
    } finally {
      setJsonBusy(false);
    }
  };

  const handleFilesDownload = async () => {
    const id = convId();
    const pid = projectId();
    if (!id) {
      toast.error('未检测到会话 ID，请在具体对话页面使用（URL 中应包含 /c/xxxx）。');
      return;
    }

    setFilesBusy(true);
    setFilesTitle('下载文件中…');

    try {
      await refreshCredStatus();
      if (!Cred.token) throw new Error('没有有效的 accessToken');

      let data = lastConvData.current;
      if (!data || data.conversation_id !== id) {
        data = await fetchConversation(id, pid || undefined);
        lastConvData.current = data;
      }

      const cands = collectFileCandidates(data);
      if (!cands.length) {
        toast.info('未找到可下载的文件/指针。');
        setFilesTitle('未找到文件');
        setFilesBusy(false);
        return;
      }

      // Note: showFilePreviewDialog is still imperative/callback-based for now
      showFilePreviewDialog(cands, async (selected) => {
        setFilesBusy(true);
        setFilesTitle(`下载中 (${selected.length})…`);

        try {
          const res = await downloadSelectedFiles(selected);
          setFilesTitle(`完成 ${res.ok}/${res.total}（可再次点击）`);
          toast.success(`文件下载完成，成功 ${res.ok}/${res.total}`);
        } catch (e: any) {
          console.error('[ChatGPT-Multimodal-Exporter] 下载失败：', e);
          toast.error('下载失败: ' + (e && e.message ? e.message : e));
          setFilesTitle('下载失败 ❌');
        } finally {
          setFilesBusy(false);
        }
      });
      setFilesBusy(false);

    } catch (e: any) {
      console.error('[ChatGPT-Multimodal-Exporter] 下载失败：', e);
      toast.error('下载失败: ' + (e && e.message ? e.message : e));
      setFilesTitle('下载失败 ❌');
      setFilesBusy(false);
    }
  };

  const handleBatchExport = () => {
    showBatchExportDialog();
  };

  const handleAutoSaveClick = () => {
    setShowSettings(true);
  };

  const isOk = status.hasToken && status.hasAcc;

  return (
    <div className="cgptx-mini-wrap">
      {showSettings && (
        <AutoSaveSettings
          status={autoSaveStatus}
          onClose={() => setShowSettings(false)}
        />
      )}
      <div className="cgptx-mini-badges-col">
        <div
          className={`cgptx-mini-badge ${isOk ? 'ok' : 'bad'}`}
          id="cgptx-mini-badge"
          title={status.debug}
        >
          {`Token: ${status.hasToken ? '✔' : '✖'} / Account id: ${status.hasAcc ? '✔' : '✖'}`}
        </div>
        <div className="cgptx-mini-badge info" title="Current Workspace Context">
          {workspaceInfo}
        </div>
      </div>
      <div className="cgptx-mini-btn-row">
        <button
          id="cgptx-mini-btn"
          className="cgptx-mini-btn"
          title={jsonTitle}
          onClick={handleJsonExport}
          disabled={jsonBusy}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>
        <button
          id="cgptx-mini-btn-files"
          className="cgptx-mini-btn"
          title={filesTitle}
          onClick={handleFilesDownload}
          disabled={filesBusy}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
            <line x1="12" y1="22.08" x2="12" y2="12"></line>
          </svg>
        </button>
        <button
          id="cgptx-mini-btn-batch"
          className="cgptx-mini-btn"
          title="批量导出 JSON + 附件（可勾选）"
          onClick={handleBatchExport}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
        <button
          id="cgptx-mini-btn-autosave"
          className={`cgptx-mini-btn ${autoSaveStatus.state === 'saving' ? 'busy' : ''}`}
          title={`自动保存设置\n状态: ${autoSaveStatus.state}`}
          onClick={handleAutoSaveClick}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
        </button>
      </div>
      <style>{`
                .cgptx-mini-badges-col {
                    display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; align-items: flex-end;
                }
                .cgptx-mini-badge.info {
                    background: #e0f2fe; color: #0369a1; border-color: #bae6fd;
                }
            `}</style>
    </div>
  );
}
