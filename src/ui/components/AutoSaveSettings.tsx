import { useState, useEffect } from 'preact/hooks';
import { AutoSaveStatus, runAutoSave, startAutoSaveLoop, stopAutoSaveLoop, pickAndSaveRootHandle, getRootHandle } from '../../autoSave';
import { Logger } from '../../logger';
import { toast } from 'sonner';

interface Props {
    status: AutoSaveStatus;
    onClose: () => void;
}

export function AutoSaveSettings({ status, onClose }: Props) {
    const [enabled, setEnabled] = useState(false);
    const [intervalMin, setIntervalMin] = useState(5);
    const [debug, setDebug] = useState(Logger.isDebug());
    const [rootPath, setRootPath] = useState<string>('');

    useEffect(() => {
        // Check if enabled (loop running) - strictly speaking we don't expose if loop is running
        // We can infer or add a getter. For now, let's assume if we have a handle, we default to enabled?
        // Or we should add `isAutoSaveRunning()` to autoSave.ts
        // For now, let's just manage local state and sync on mount?
        // Actually, FloatingEntry starts it on mount if handle exists.
        getRootHandle().then(h => {
            setEnabled(!!h);
            setRootPath(h ? h.name : '未选择');
        });
    }, []);

    const toggleEnabled = async () => {
        if (enabled) {
            stopAutoSaveLoop();
            setEnabled(false);
            toast.info('自动保存已暂停');
        } else {
            const h = await getRootHandle();
            if (!h) {
                const newHandle = await pickAndSaveRootHandle();
                if (newHandle) {
                    setRootPath(newHandle.name);
                    startAutoSaveLoop(intervalMin * 60 * 1000);
                    setEnabled(true);
                    toast.success('自动保存已开启');
                }
            } else {
                startAutoSaveLoop(intervalMin * 60 * 1000);
                setEnabled(true);
                toast.success('自动保存已开启');
            }
        }
    };

    const handleDebugChange = (e: any) => {
        const val = e.target.checked;
        setDebug(val);
        Logger.setDebug(val);
    };

    const handleIntervalChange = (e: any) => {
        const val = parseInt(e.target.value, 10);
        if (val > 0) {
            setIntervalMin(val);
            if (enabled) {
                // Restart with new interval
                stopAutoSaveLoop();
                startAutoSaveLoop(val * 60 * 1000);
            }
        }
    };

    const changeFolder = async () => {
        const h = await pickAndSaveRootHandle();
        if (h) {
            setRootPath(h.name);
            toast.success('保存目录已更新');
            // If enabled, it will continue using new handle (as getRootHandle returns it)
        }
    };

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
                                    status.state === 'saving' ? '保存中...' : '错误'}
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
                        <input type="checkbox" checked={enabled} onChange={toggleEnabled} />
                    </div>

                    <div className="cgptx-setting-row">
                        <label>保存间隔 (分钟)</label>
                        <input
                            type="number"
                            min="1"
                            value={intervalMin}
                            onChange={handleIntervalChange}
                            disabled={!enabled}
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
                        <label>调试模式 (控制台日志)</label>
                        <input type="checkbox" checked={debug} onChange={handleDebugChange} />
                    </div>

                    <div className="cgptx-actions">
                        <button
                            className="cgptx-btn-primary"
                            onClick={() => { runAutoSave(); toast.info('已触发立即保存'); }}
                            disabled={status.state !== 'idle' && status.state !== 'error'}
                        >
                            立即运行
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
                .cgptx-status-msg { font-size: 12px; color: #666; margin-bottom: 4px; }
                .cgptx-status-time { font-size: 12px; color: #999; }
                .cgptx-folder-display { display: flex; align-items: center; gap: 8px; max-width: 60%; }
                .cgptx-folder-display span { 
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #666;
                }
                .cgptx-btn-sm {
                    padding: 2px 8px; font-size: 12px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer;
                }
                .cgptx-actions { margin-top: 20px; display: flex; justify-content: flex-end; }
                .cgptx-btn-primary {
                    background: #10a37f; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 500;
                }
                .cgptx-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
                input[type="number"] { width: 60px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; }
            `}</style>
        </div>
    );
}
