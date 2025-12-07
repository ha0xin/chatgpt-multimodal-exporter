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
    const [nextRunText, setNextRunText] = useState('');

    const handleBatchExport = () => {
        showBatchExportDialog();
    };

    const handleAutoSaveClick = () => {
        setShowSettings(true);
    };

    // Countdown effect
    useEffect(() => {
        if (autoSaveState.status !== 'idle' || !autoSaveState.nextRun) {
            setNextRunText('');
            return;
        }

        const update = () => {
            const diff = Math.max(0, Math.ceil((autoSaveState.nextRun - Date.now()) / 1000));
            if (diff > 60) {
                 setNextRunText(`Next: ${Math.round(diff / 60)}m`);
            } else {
                 setNextRunText(`Next: ${diff}s`);
            }
        };

        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [autoSaveState.nextRun, autoSaveState.status]);

    // Derived status props
    const isSaving = autoSaveState.status === 'saving' || autoSaveState.status === 'checking';
    const isError = autoSaveState.status === 'error';
    const canShowCountdown = autoSaveState.status === 'idle' && autoSaveState.role === 'leader';
    
    // Status Text Logic
    let tooltip = `自动保存设置\n状态: ${autoSaveState.status}`;
    if (autoSaveState.role !== 'unknown') {
        tooltip += ` (${autoSaveState.role === 'leader' ? 'Leader' : 'Standby'})`;
    }
    if (autoSaveState.message) {
        tooltip += `\n${autoSaveState.message}`;
    }
    if (autoSaveState.lastError) {
        tooltip += `\nError: ${autoSaveState.lastError}`;
    }

    // Button classes
    // Add 'busy' for spinning or pulsing
    // Add distinct color for error
    let btnClass = 'cgptx-mini-btn';
    if (isSaving) btnClass += ' busy';
    if (isError) btnClass += ' error'; // Assumes CSS for .error exists or will just look normal
    
    // Inline style for error if class doesn't exist? 
    // I'll stick to className and standard SVGs.
    // Maybe add a small dot?

    return (
        <Fragment>
            {showSettings && (
                <AutoSaveSettings
                    // Pass a compatible object or refactor Settings too?
                    // AutoSaveSettings expects { lastRun, state, message }
                    // AutoSaveUIState matches this shape mostly?
                    // AutoSaveUIState has 'status' not 'state'. Adapter needed.
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
                {/* Status Indicator / Countdown Label */}
                {(canShowCountdown && nextRunText) && (
                     <span style={{ 
                         position: 'absolute', 
                         top: '-14px', 
                         right: '50%', 
                         transform: 'translateX(50%)',
                         fontSize: '9px', 
                         whiteSpace: 'nowrap',
                         color: '#888',
                         pointerEvents: 'none'
                     }}>
                        {nextRunText}
                     </span>
                )}
                {/* Standby Label */}
                {(autoSaveState.role === 'standby') && (
                     <span style={{ 
                         position: 'absolute', 
                         top: '-14px', 
                         right: '50%', 
                         transform: 'translateX(50%)',
                         fontSize: '9px', 
                         whiteSpace: 'nowrap',
                         color: '#aaa',
                         pointerEvents: 'none'
                     }}>
                        Standby
                     </span>
                )}

                <button
                    id="cgptx-mini-btn-autosave"
                    className={btnClass}
                    title={tooltip}
                    onClick={handleAutoSaveClick}
                    style={isError ? { color: '#ef4444' } : {}}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                    </svg>
                    
                    {/* Role Indicator Dot */}
                    {autoSaveState.role === 'leader' && !isSaving && !isError && (
                         <circle cx="20" cy="4" r="3" fill="#10b981" stroke="white" strokeWidth="1" 
                                style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6 }} />
                    )}
                </button>
            </div>
        </Fragment>
    );
}
