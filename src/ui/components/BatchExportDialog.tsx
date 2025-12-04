import { useState, useEffect, useRef } from 'preact/hooks';
import { BATCH_CONCURRENCY, saveBlob } from '../../utils';
import { collectAllConversationTasks } from '../../conversations';
import { runBatchExport } from '../../batchExport';
import { Project, Task } from '../../types';

interface BatchExportDialogProps {
    onClose: () => void;
}

interface GroupState {
    projectId: string | null;
    label: string;
    items: { id: string; title: string }[];
    collapsed: boolean;
}

export function BatchExportDialog({ onClose }: BatchExportDialogProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [listData, setListData] = useState<{ rootIds: string[]; roots: any[]; projects: Project[] } | null>(null);
    const [groups, setGroups] = useState<GroupState[]>([]);
    const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
    const [includeAttachments, setIncludeAttachments] = useState(true);

    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null);
    const [statusText, setStatusText] = useState('加载会话列表…');

    const cancelRef = useRef<{ cancel: boolean }>({ cancel: false });

    const makeKey = (projectId: string | null, id: string) => `${projectId || 'root'}::${id}`;
    const parseKey = (key: string): Task => {
        const idx = key.indexOf('::');
        const pid = key.slice(0, idx);
        const id = key.slice(idx + 2);
        return { id, projectId: pid === 'root' ? null : pid };
    };

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const res = await collectAllConversationTasks((pct, text) => {
                setProgress({ pct, text });
            });
            setListData(res);

            // Build groups
            const newGroups: GroupState[] = [];
            const rootsList = getRootsList(res);
            if (rootsList.length) {
                newGroups.push({ label: '无项目（个人会话）', projectId: null, items: rootsList, collapsed: false });
            }
            (res.projects || []).forEach((p: Project) => {
                const convs = Array.isArray(p.convs) ? p.convs : [];
                newGroups.push({
                    label: p.projectName || p.projectId || '未命名项目',
                    projectId: p.projectId,
                    items: convs,
                    collapsed: false
                });
            });
            setGroups(newGroups);

            // Seed selection
            const initialSet = new Set<string>();
            rootsList.forEach((it: any) => initialSet.add(makeKey(null, it.id)));
            (res.projects || []).forEach((p: Project) => {
                (p.convs || []).forEach((c) => initialSet.add(makeKey(p.projectId, c.id)));
            });
            setSelectedSet(initialSet);

            setLoading(false);
            setProgress(null);
            setStatusText(`共 ${newGroups.reduce((n, g) => n + g.items.length, 0)} 条，已选 ${initialSet.size}`);
        } catch (e: any) {
            console.error('[ChatGPT-Multimodal-Exporter] 拉取列表失败', e);
            setError(e.message || String(e));
            setStatusText('拉取列表失败');
        }
    };

    const getRootsList = (data: any) => {
        if (data && Array.isArray(data.roots) && data.roots.length) return data.roots;
        if (data && Array.isArray(data.rootIds) && data.rootIds.length)
            return data.rootIds.map((id: string) => ({ id, title: id }));
        return [];
    };

    const toggleGroupCollapse = (idx: number) => {
        const newGroups = [...groups];
        newGroups[idx].collapsed = !newGroups[idx].collapsed;
        setGroups(newGroups);
    };

    const toggleGroupSelect = (group: GroupState, checked: boolean) => {
        const newSet = new Set(selectedSet);
        const keys = group.items.map(it => makeKey(group.projectId, it.id));

        if (checked) {
            keys.forEach(k => newSet.add(k));
        } else {
            keys.forEach(k => newSet.delete(k));
        }
        setSelectedSet(newSet);
        setStatusText(`已选 ${newSet.size} 条`);
    };

    const toggleItemSelect = (key: string) => {
        const newSet = new Set(selectedSet);
        if (newSet.has(key)) newSet.delete(key);
        else newSet.add(key);
        setSelectedSet(newSet);
        setStatusText(`已选 ${newSet.size} 条`);
    };

    const toggleAll = () => {
        if (!listData) return;
        const allKeys: string[] = [];
        groups.forEach(g => g.items.forEach(it => allKeys.push(makeKey(g.projectId, it.id))));

        const allChecked = allKeys.every(k => selectedSet.has(k));
        const newSet = new Set(selectedSet);

        if (allChecked) {
            allKeys.forEach(k => newSet.delete(k));
        } else {
            allKeys.forEach(k => newSet.add(k));
        }
        setSelectedSet(newSet);
        setStatusText(`已选 ${newSet.size} 条`);
    };

    const startExport = async () => {
        if (!listData) return;
        const tasks = Array.from(selectedSet)
            .map((k) => parseKey(k))
            .filter((t) => !!t.id);

        if (!tasks.length) {
            alert('请至少选择一条会话');
            return;
        }

        cancelRef.current.cancel = false;
        setExporting(true);
        setStatusText('准备导出…');
        setProgress({ pct: 0, text: '准备中' });

        const projectMapForTasks = new Map<string, Project>();
        (listData.projects || []).forEach((p) => projectMapForTasks.set(p.projectId, p));

        const seenProj = new Set<string>();
        const selectedProjects: Project[] = [];
        tasks.forEach((t) => {
            if (!t.projectId) return;
            if (seenProj.has(t.projectId)) return;
            seenProj.add(t.projectId);
            const p = projectMapForTasks.get(t.projectId);
            if (p) selectedProjects.push(p);
        });
        const selectedRootIds = tasks.filter((t) => !t.projectId).map((t) => t.id);

        try {
            const blob = await runBatchExport({
                tasks,
                projects: selectedProjects,
                rootIds: selectedRootIds,
                includeAttachments: includeAttachments,
                concurrency: BATCH_CONCURRENCY,
                progressCb: (pct, txt) => setProgress({ pct, text: txt }),
                cancelRef: cancelRef.current,
            });

            if (cancelRef.current.cancel) {
                setStatusText('已取消');
                return;
            }

            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            saveBlob(blob, `chatgpt-batch-${ts}.zip`);
            setProgress({ pct: 100, text: '完成' });
            setStatusText('完成 ✅（已下载 ZIP）');
        } catch (e: any) {
            console.error('[ChatGPT-Multimodal-Exporter] 批量导出失败', e);
            alert('批量导出失败：' + (e && e.message ? e.message : e));
            setStatusText('失败');
        } finally {
            setExporting(false);
            cancelRef.current.cancel = false;
        }
    };

    const handleStop = () => {
        cancelRef.current.cancel = true;
        setStatusText('请求取消中…');
    };

    return (
        <div className="cgptx-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="cgptx-modal-box">
                <div className="cgptx-modal-header">
                    <div className="cgptx-modal-title">批量导出对话（JSON + 附件）</div>
                    <div className="cgptx-modal-actions">
                        <button className="cgptx-btn" onClick={toggleAll} disabled={exporting || loading}>全选/反选</button>
                        <button className="cgptx-btn primary" onClick={startExport} disabled={exporting || loading}>开始导出</button>
                        <button className="cgptx-btn" onClick={handleStop} disabled={!exporting}>停止</button>
                        <button className="cgptx-btn" onClick={onClose}>关闭</button>
                    </div>
                </div>

                <div className="cgptx-chip">{statusText}</div>

                <div className="cgptx-modal-actions" style={{ justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                            type="checkbox"
                            checked={includeAttachments}
                            onChange={(e) => setIncludeAttachments(e.currentTarget.checked)}
                            disabled={exporting}
                        />
                        <span>包含附件（ZIP）</span>
                    </label>
                </div>

                <div className="cgptx-list" style={{ maxHeight: '46vh', overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
                    {loading && (
                        <div className="cgptx-item" style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                            {progress ? (
                                <div style={{ width: '100%', textAlign: 'center' }}>
                                    <div>{progress.text} ({Math.round(progress.pct)}%)</div>
                                    <div className="cgptx-progress-track" style={{ marginTop: '10px' }}>
                                        <div className="cgptx-progress-bar" style={{ width: `${progress.pct}%` }}></div>
                                    </div>
                                </div>
                            ) : (
                                <div>加载中...</div>
                            )}
                        </div>
                    )}
                    {error && <div className="cgptx-item" style={{ color: 'red' }}>{error}</div>}

                    {!loading && !error && groups.map((group, gIdx) => {
                        const groupKeys = group.items.map(it => makeKey(group.projectId, it.id));
                        const checkedCount = groupKeys.filter(k => selectedSet.has(k)).length;
                        const isAll = checkedCount === groupKeys.length && groupKeys.length > 0;
                        const isIndeterminate = checkedCount > 0 && checkedCount < groupKeys.length;

                        return (
                            <div className="cgptx-group" key={gIdx}>
                                <div className="cgptx-group-header">
                                    <input
                                        type="checkbox"
                                        checked={isAll}
                                        ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
                                        onChange={(e) => toggleGroupSelect(group, e.currentTarget.checked)}
                                    />
                                    <span
                                        className="cgptx-arrow"
                                        onClick={() => toggleGroupCollapse(gIdx)}
                                    >
                                        {group.collapsed ? '▶' : '▼'}
                                    </span>
                                    <div className="group-title" onClick={() => toggleGroupCollapse(gIdx)}>{group.label}</div>
                                    <div className="group-count">{group.items.length} 条</div>
                                </div>

                                <div className="cgptx-group-list" style={{ display: group.collapsed ? 'none' : 'block' }}>
                                    {group.items.map(item => {
                                        const key = makeKey(group.projectId, item.id);
                                        return (
                                            <div className="cgptx-item" key={key}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSet.has(key)}
                                                    onChange={() => toggleItemSelect(key)}
                                                />
                                                <div></div>
                                                <div>
                                                    <div className="title">{item.title || item.id}</div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {!loading && progress && (
                    <div className="cgptx-progress-wrap" style={{ display: 'flex' }}>
                        <div className="cgptx-progress-track">
                            <div className="cgptx-progress-bar" style={{ width: `${progress.pct}%` }}></div>
                        </div>
                        <div className="cgptx-progress-text">
                            {progress.text} ({Math.round(progress.pct)}%)
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
