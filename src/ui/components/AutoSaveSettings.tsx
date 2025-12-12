import { useState, useEffect } from 'preact/hooks';
import { AutoSaveStatus, runAutoSave, runFullAutoSave, startAutoSaveLoop, stopAutoSaveLoop, pickAndSaveRootHandle, getRootHandle } from '../../autoSave';
import { Logger } from '../../logger';
import { toast } from 'sonner';

interface Props {
    status: AutoSaveStatus;
    onClose: () => void;
}

export function AutoSaveSettings({ status, onClose }: Props) {
    // Initial state loading
    const [loading, setLoading] = useState(true);
    
    // Effective state (what is currently running)
    const [effectiveEnabled, setEffectiveEnabled] = useState(false);
    
    // Pending state (what user is editing)
    const [pendingEnabled, setPendingEnabled] = useState(false);
    const [pendingInterval, setPendingInterval] = useState(5);
    const [debug, setDebug] = useState(Logger.isDebug());
    const [rootPath, setRootPath] = useState<string>('');

    // Load initial state
    useEffect(() => {
        getRootHandle().then(h => {
            const hasSetting = localStorage.getItem('chatgpt_exporter_autosave_enabled') !== null;
            const storedEnabled = localStorage.getItem('chatgpt_exporter_autosave_enabled') === 'true';
            
            // Load interval
            const storedInterval = localStorage.getItem('chatgpt_exporter_autosave_interval');
            const initialInterval = storedInterval ? parseInt(storedInterval, 10) : 5;
            setPendingInterval(initialInterval);

            // "Effective" enabled means: Handle exists AND (Setting is true OR No Setting)
            const isEnabledEffectively = !!h && (hasSetting ? storedEnabled : true);
            
            setEffectiveEnabled(isEnabledEffectively);
            setPendingEnabled(isEnabledEffectively); // Initialize pending with effective
            setRootPath(h ? h.name : '未选择');
            setLoading(false);
        });
    }, []);

    const handleSaveSettings = async () => {
        // 1. Save Enabled State & Interval
        localStorage.setItem('chatgpt_exporter_autosave_enabled', String(pendingEnabled));
        localStorage.setItem('chatgpt_exporter_autosave_interval', String(pendingInterval));
        
        // 2. Logic to Start/Stop/Update Loop
        if (!pendingEnabled) {
            // User requested Disable
            if (effectiveEnabled) {
                stopAutoSaveLoop();
                toast.info('自动保存已暂停');
            }
        } else {
            // User requested Enable (or Update if already enabled)
            const h = await getRootHandle();
            if (!h) {
                // If trying to enable but no handle, ask for one
                const newHandle = await pickAndSaveRootHandle();
                if (newHandle) {
                    setRootPath(newHandle.name);
                    // Start (it will initialize if not started)
                    startAutoSaveLoop(pendingInterval * 60 * 1000);
                    toast.success('自动保存已开启');
                } else {
                    // User cancelled folder picker
                    setPendingEnabled(false);
                    return; 
                }
            } else {
                // Has handle.
                // Call startAutoSaveLoop with new interval.
                // Our unified start function now handles "update if running" logic safely
                // without releasing the lock (avoiding Standby issue).
                startAutoSaveLoop(pendingInterval * 60 * 1000);
                toast.success('设置已保存');
            }
        }
        
        setEffectiveEnabled(pendingEnabled);
        onClose();
    };

    const handleDebugChange = (e: any) => {
        const val = e.target.checked;
        setDebug(val);
        Logger.setDebug(val);
    };

    const changeFolder = async () => {
        const h = await pickAndSaveRootHandle();
        if (h) {
            setRootPath(h.name);
            toast.success('保存目录已更新');
            // Check if we need to auto-start if it was disabled implicitly due to no folder
            // If user explicitly enabled it elsewhere, it will be handled by handleSaveSettings.
            // If effective status is running, it keeps running.
        }
    };

    if (loading) return null; // Or spinner

    return (
        <div className="cgptx-dialog-overlay" onClick={onClose}>
            <div className="cgptx-dialog-content" onClick={e => e.stopPropagation()}>
                <div className="cgptx-dialog-header">
                    <h3>自动保存设置</h3>
                    <button className="cgptx-close-btn" onClick={onClose}>×</button>
                </div>

                <div className="cgptx-dialog-body">
                    <div className="cgptx-setting-row">
                        <label>状态:</label>
                        <span className={`cgptx-status-badge ${status.state}`}>
                            {status.state === 'idle' ? '空闲' :
                                status.state === 'checking' ? '检查中...' :
                                    status.state === 'saving' ? '保存中...' : 
                                        status.state === 'disabled' ? '已禁用' : '错误'}
                        </span>
                    </div>
                    {status.message && <div className="cgptx-status-msg">{status.message}</div>}
                    {status.lastRun > 0 && (
                        <div className="cgptx-status-time">
                            上次运行: {new Date(status.lastRun).toLocaleString()}
                        </div>
                    )}

                    <hr className="cgptx-divider" />

                    <div className="cgptx-setting-row">
                        <label>启用自动保存</label>
                        <input 
                            type="checkbox" 
                            checked={pendingEnabled} 
                            onChange={(e: any) => setPendingEnabled(e.target.checked)} 
                        />
                    </div>

                    <div className="cgptx-setting-row" style={!pendingEnabled ? { opacity: 0.5 } : {}}>
                        <label>保存间隔 (分钟)</label>
                        <input
                            type="number"
                            min="1"
                            value={pendingInterval}
                            onChange={(e: any) => setPendingInterval(parseInt(e.target.value, 10))}
                            disabled={!pendingEnabled}
                        />
                    </div>

                    <div className="cgptx-setting-row">
                        <label>保存目录</label>
                        <div className="cgptx-folder-display">
                            <span>{rootPath}</span>
                            <button className="cgptx-btn-sm" onClick={changeFolder}>更改</button>
                        </div>
                    </div>

                    <div className="cgptx-setting-row">
                        <label>调试模式 (实时生效)</label>
                        <input type="checkbox" checked={debug} onChange={handleDebugChange} />
                    </div>

                    <div className="cgptx-actions" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className="cgptx-btn-secondary"
                                onClick={() => { runAutoSave(); toast.info('已触发立即保存'); }}
                                disabled={status.state !== 'idle' && status.state !== 'error'}
                                title="Run standard incremental check"
                            >
                                立即运行
                            </button>
                            <button
                                className="cgptx-btn-secondary"
                                onClick={() => { runFullAutoSave(); toast.info('已触发全量扫描'); }}
                                disabled={status.state !== 'idle' && status.state !== 'error'}
                                title="Checks ALL conversations (slow)"
                            >
                                全部扫描
                            </button>
                        </div>
                        
                        <button
                            className="cgptx-btn-primary"
                            onClick={handleSaveSettings}
                        >
                            保存设置
                        </button>
                    </div>
                </div>
            </div>
            <style>{`
                .cgptx-dialog-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.5); z-index: 10000;
                    display: flex; align-items: center; justify-content: center;
                }
                .cgptx-dialog-content {
                    background: white; padding: 20px; border-radius: 12px;
                    width: 360px; max-width: 90vw;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                    font-family: system-ui, -apple-system, sans-serif;
                }
                .cgptx-dialog-header {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 16px;
                }
                .cgptx-dialog-header h3 { margin: 0; font-size: 18px; font-weight: 600; }
                .cgptx-close-btn {
                    background: none; border: none; font-size: 24px; cursor: pointer; color: #666;
                }
                .cgptx-setting-row {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 12px; font-size: 14px;
                }
                .cgptx-divider { border: 0; border-top: 1px solid #eee; margin: 16px 0; }
                .cgptx-status-badge {
                    padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;
                }
                .cgptx-status-badge.idle { background: #f3f4f6; color: #374151; }
                .cgptx-status-badge.checking { background: #dbeafe; color: #1e40af; }
                .cgptx-status-badge.saving { background: #dcfce7; color: #166534; }
                .cgptx-status-badge.error { background: #fee2e2; color: #991b1b; }
                .cgptx-status-badge.disabled { background: #f3f4f6; color: #9ca3af; border: 1px solid #eee; }
                .cgptx-status-msg { font-size: 12px; color: #666; margin-bottom: 4px; }
                .cgptx-status-time { font-size: 12px; color: #999; }
                .cgptx-folder-display { display: flex; align-items: center; gap: 8px; max-width: 60%; }
                .cgptx-folder-display span { 
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #666;
                }
                .cgptx-btn-sm {
                    padding: 2px 8px; font-size: 12px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer;
                }
                .cgptx-actions { margin-top: 20px; display: flex; }
                .cgptx-btn-primary {
                    background: #10a37f; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 500;
                }
                .cgptx-btn-secondary {
                    background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 500;
                }
                .cgptx-btn-primary:disabled, .cgptx-btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
                input[type="number"] { width: 60px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; }
                input[type="number"]:disabled { background: #f3f4f6; color: #9ca3af; cursor: not-allowed; }
            `}</style>
        </div>
    );
}
