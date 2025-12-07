import { Fragment } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { AutoSaveSettings } from '../components/AutoSaveSettings';
import { AutoSaveUIState } from '../hooks/useAutoSave';
import { showBatchExportDialog } from '../dialogs/BatchExportDialog';

interface ActionButtonsProps {
    autoSaveState: AutoSaveUIState;
}

export function ActionButtons({ autoSaveState }: ActionButtonsProps) {
    const [showSettings, setShowSettings] = useState(false);
    
    const handleBatchExport = () => {
        showBatchExportDialog();
    };

    const handleAutoSaveClick = () => {
        setShowSettings(true);
    };



    // Derived status props
    const { status, nextRun, role, message, lastError } = autoSaveState;
    const isSaving = status === 'saving' || status === 'checking';
    const isError = status === 'error';
    const isDisabled = status === 'disabled';
    const isIdle = status === 'idle';

    // Calculate time text for Idle state
    const [timeText, setTimeText] = useState('');
    
    useEffect(() => {
        if (!isIdle || !nextRun || isDisabled) {
            setTimeText('');
            return;
        }
        const update = () => {
            const diff = Math.max(0, Math.ceil((nextRun - Date.now()) / 1000));
            if (diff > 60) {
                 setTimeText(`${Math.round(diff / 60)}m`);
            } else {
                 setTimeText(`${diff}s`);
            }
        };
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [nextRun, isIdle, isDisabled]);

    // Tooltip construction
    let tooltip = `自动保存设置\n状态: ${status}`;
    if (role !== 'unknown') {
        tooltip += ` (${role === 'leader' ? 'Leader' : 'Standby'})`;
    }
    if (message) tooltip += `\n${message}`;
    if (lastError) tooltip += `\nError: ${lastError}`;
    if (isDisabled) tooltip = "自动保存已关闭";

    // Icon & Color Logic
    let iconContent;
    let btnStyle: any = {};
    
    if (isDisabled) {
        // Disabled: Gray Icon with X
        btnStyle.color = '#9ca3af'; // Gray-400
        iconContent = (
            <div style={{ position: 'relative', width: 16, height: 16 }}>
                {/* Floppy */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                     <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                     <polyline points="17 21 17 13 7 13 7 21"></polyline>
                     <polyline points="7 3 7 8 15 8"></polyline>
                </svg>
                {/* X Overlay */}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" 
                     style={{ position: 'absolute', bottom: -2, right: -2, color: '#ef4444', background: 'white', borderRadius: '50%' }}>
                     <line x1="18" y1="6" x2="6" y2="18"></line>
                     <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </div>
        );
    } else if (isError) {
        // Error: Red Icon
        btnStyle.color = '#ef4444';
        iconContent = (
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                 <circle cx="12" cy="12" r="10"></circle>
                 <line x1="12" y1="8" x2="12" y2="12"></line>
                 <line x1="12" y1="16" x2="12.01" y2="16"></line>
             </svg>
        );
    } else if (isSaving) {
        // Saving: Rotating Sync
        btnStyle.color = '#3b82f6'; // Blue
        iconContent = (
            <svg className="busy" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
                <path d="M16 21h5v-5"></path>
            </svg>
        );
    } else {
        // Idle: Green Floppy + Time Overlay
        btnStyle.color = '#10b981'; // Green
        iconContent = (
            <div style={{ position: 'relative', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                     <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                     <polyline points="17 21 17 13 7 13 7 21"></polyline>
                     <polyline points="7 3 7 8 15 8"></polyline>
                </svg>
                {/* Time Overlay */}
                {timeText && (
                    <span style={{
                        position: 'absolute',
                        bottom: -4,
                        right: -6,
                        background: '#10b981',
                        color: 'white',
                        fontSize: '9px',
                        padding: '0 2px',
                        borderRadius: '4px',
                        fontWeight: 'bold',
                        lineHeight: '1',
                        transform: 'scale(0.9)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                    }}>
                        {timeText}
                    </span>
                )}
            </div>
        );
    }

    return (
        <Fragment>
            {showSettings && (
                <AutoSaveSettings
                    status={{
                        lastRun: autoSaveState.lastRun,
                        state: autoSaveState.status,
                        message: autoSaveState.message
                    }}
                    onClose={() => setShowSettings(false)}
                />
            )}
            <button
                id="cgptx-mini-btn-batch"
                className="cgptx-mini-btn"
                title="批量导出 JSON + 附件（可勾选）"
                onClick={handleBatchExport}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
            </button>
            
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button
                    id="cgptx-mini-btn-autosave"
                    className="cgptx-mini-btn"
                    title={tooltip}
                    onClick={handleAutoSaveClick}
                    style={btnStyle}
                >
                    {iconContent}
                </button>
            </div>
            <style>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
                .cgptx-mini-btn svg.busy { animation: spin 1s linear infinite; }
            `}</style>
        </Fragment>
    );
}
