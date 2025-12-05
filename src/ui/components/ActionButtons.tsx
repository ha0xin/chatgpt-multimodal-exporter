import { Fragment } from 'preact';
import { AutoSaveSettings } from '../components/AutoSaveSettings';
import { AutoSaveStatus } from '../../autoSave';
import { showBatchExportDialog } from '../dialogs/BatchExportDialog';
import { useState } from 'preact/hooks';

interface ActionButtonsProps {
    autoSaveStatus: AutoSaveStatus;
}

export function ActionButtons({ autoSaveStatus }: ActionButtonsProps) {
    const [showSettings, setShowSettings] = useState(false);

    const handleBatchExport = () => {
        showBatchExportDialog();
    };

    const handleAutoSaveClick = () => {
        setShowSettings(true);
    };

    return (
        <Fragment>
            {showSettings && (
                <AutoSaveSettings
                    status={autoSaveStatus}
                    onClose={() => setShowSettings(false)}
                />
            )}
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
        </Fragment>
    );
}
