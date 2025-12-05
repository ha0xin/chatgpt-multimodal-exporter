import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { BATCH_CONCURRENCY, saveBlob } from '../../utils';
import { collectAllConversationTasks } from '../../conversations';
import { runBatchExport } from '../../batchExport';
import { Project, Task } from '../../types';
import { Checkbox } from './Checkbox';
import { toast } from 'sonner';

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
    const loading = useSignal(true);
    const error = useSignal<string | null>(null);
    const listData = useSignal<{ rootIds: string[]; roots: any[]; projects: Project[] } | null>(null);
    const groups = useSignal<GroupState[]>([]);
    const selectedSet = useSignal<Set<string>>(new Set());
    const includeAttachments = useSignal(true);

    const exporting = useSignal(false);
    const progress = useSignal<{ pct: number; text: string } | null>(null);
    const statusText = useSignal('加载会话列表…');

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
                progress.value = { pct, text };
            });
            listData.value = res;

            // Build groups
            const newGroups: GroupState[] = [];
            const rootsList = getRootsList(res);
            if (rootsList.length) {
                newGroups.push({ label: '无项目', projectId: null, items: rootsList, collapsed: false });
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
            groups.value = newGroups;

            // Seed selection
            const initialSet = new Set<string>();
            rootsList.forEach((it: any) => initialSet.add(makeKey(null, it.id)));
            (res.projects || []).forEach((p: Project) => {
                (p.convs || []).forEach((c) => initialSet.add(makeKey(p.projectId, c.id)));
            });
            selectedSet.value = initialSet;

            loading.value = false;
            progress.value = null;
            statusText.value = `共 ${newGroups.reduce((n, g) => n + g.items.length, 0)} 条，已选 ${initialSet.size}`;
        } catch (e: any) {
            console.error('[ChatGPT-Multimodal-Exporter] 拉取列表失败', e);
            error.value = e.message || String(e);
            statusText.value = '拉取列表失败';
        }
    };

    const getRootsList = (data: any) => {
        if (data && Array.isArray(data.roots) && data.roots.length) return data.roots;
        if (data && Array.isArray(data.rootIds) && data.rootIds.length)
            return data.rootIds.map((id: string) => ({ id, title: id }));
        return [];
    };

    const toggleGroupCollapse = (idx: number) => {
        const newGroups = [...groups.value];
        newGroups[idx].collapsed = !newGroups[idx].collapsed;
        groups.value = newGroups;
    };

    const toggleGroupSelect = (group: GroupState, checked: boolean) => {
        const newSet = new Set(selectedSet.value);
        const keys = group.items.map(it => makeKey(group.projectId, it.id));

        if (checked) {
            keys.forEach(k => newSet.add(k));
        } else {
            keys.forEach(k => newSet.delete(k));
        }
        selectedSet.value = newSet;
        statusText.value = `已选 ${newSet.size} 条`;
    };

    const toggleItemSelect = (key: string) => {
        const newSet = new Set(selectedSet.value);
        if (newSet.has(key)) newSet.delete(key);
        else newSet.add(key);
        selectedSet.value = newSet;
        statusText.value = `已选 ${newSet.size} 条`;
    };

    const toggleAll = () => {
        if (!listData.value) return;
        const allKeys: string[] = [];
        groups.value.forEach(g => g.items.forEach(it => allKeys.push(makeKey(g.projectId, it.id))));

        const allChecked = allKeys.every(k => selectedSet.value.has(k));
        const newSet = new Set(selectedSet.value);

        if (allChecked) {
            allKeys.forEach(k => newSet.delete(k));
        } else {
            allKeys.forEach(k => newSet.add(k));
        }
        selectedSet.value = newSet;
        statusText.value = `已选 ${newSet.size} 条`;
    };

    const startExport = async () => {
        if (!listData.value) return;
        const tasks = Array.from(selectedSet.value)
            .map((k) => parseKey(k))
            .filter((t) => !!t.id);

        if (!tasks.length) {
            toast.error('请至少选择一条会话');
            return;
        }

        cancelRef.current.cancel = false;
        exporting.value = true;
        statusText.value = '准备导出…';
        progress.value = { pct: 0, text: '准备中' };

        const projectMapForTasks = new Map<string, Project>();
        (listData.value.projects || []).forEach((p) => projectMapForTasks.set(p.projectId, p));

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
                includeAttachments: includeAttachments.value,
                concurrency: BATCH_CONCURRENCY,
                progressCb: (pct, txt) => {
                    progress.value = { pct, text: txt };
                },
                cancelRef: cancelRef.current,
            });

            if (cancelRef.current.cancel) {
                statusText.value = '已取消';
                toast.info('批量导出已取消');
                return;
            }

            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            saveBlob(blob, `chatgpt-batch-${ts}.zip`);
            progress.value = { pct: 100, text: '完成' };
            statusText.value = '完成 ✅（已下载 ZIP）';
            toast.success('批量导出完成');
        } catch (e: any) {
            console.error('[ChatGPT-Multimodal-Exporter] 批量导出失败', e);
            toast.error('批量导出失败：' + (e && e.message ? e.message : e));
            statusText.value = '失败';
        } finally {
            exporting.value = false;
            cancelRef.current.cancel = false;
        }
    };

    const handleStop = () => {
        cancelRef.current.cancel = true;
        statusText.value = '请求取消中…';
    };

    return (
        <div className="cgptx-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="cgptx-modal-box">
                <div className="cgptx-modal-header">
                    <div className="cgptx-modal-title">批量导出对话（JSON + 附件）</div>
                    <div className="cgptx-modal-actions">
                        <button className="cgptx-btn" onClick={toggleAll} disabled={exporting.value || loading.value}>全选/反选</button>
                        <button className="cgptx-btn primary" onClick={startExport} disabled={exporting.value || loading.value}>开始导出</button>
                        <button className="cgptx-btn" onClick={handleStop} disabled={!exporting.value}>停止</button>
                        <button className="cgptx-btn" onClick={onClose}>关闭</button>
                    </div>
                </div>

                <div className="cgptx-chip">{statusText.value}</div>

                <div className="cgptx-modal-actions" style={{ justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <Checkbox
                        checked={includeAttachments.value}
                        onChange={(checked) => includeAttachments.value = checked}
                        disabled={exporting.value}
                        label="包含附件（ZIP）"
                    />
                </div>

                <div className="cgptx-list" style={{ maxHeight: '46vh', overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
                    {loading.value && (
                        <div className="cgptx-item" style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                            {progress.value ? (
                                <div style={{ width: '100%', textAlign: 'center' }}>
                                    <div>{progress.value.text} ({Math.round(progress.value.pct)}%)</div>
                                    <div className="cgptx-progress-track" style={{ marginTop: '10px' }}>
                                        <div className="cgptx-progress-bar" style={{ width: `${progress.value.pct}%` }}></div>
                                    </div>
                                </div>
                            ) : (
                                <div>加载中...</div>
                            )}
                        </div>
                    )}
                    {error.value && <div className="cgptx-item" style={{ color: 'red' }}>{error.value}</div>}

                    {!loading.value && !error.value && groups.value.map((group, gIdx) => {
                        const groupKeys = group.items.map(it => makeKey(group.projectId, it.id));
                        const checkedCount = groupKeys.filter(k => selectedSet.value.has(k)).length;
                        const isAll = checkedCount === groupKeys.length && groupKeys.length > 0;
                        const isIndeterminate = checkedCount > 0 && checkedCount < groupKeys.length;

                        return (
                            <div className="cgptx-group" key={gIdx}>
                                <div className="cgptx-group-header">
                                    <Checkbox
                                        checked={isAll}
                                        indeterminate={isIndeterminate}
                                        onChange={(checked) => toggleGroupSelect(group, checked)}
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
                                                <Checkbox
                                                    checked={selectedSet.value.has(key)}
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

                {!loading.value && progress.value && (
                    <div className="cgptx-progress-wrap" style={{ display: 'flex' }}>
                        <div className="cgptx-progress-track">
                            <div className="cgptx-progress-bar" style={{ width: `${progress.value.pct}%` }}></div>
                        </div>
                        <div className="cgptx-progress-text">
                            {progress.value.text} ({Math.round(progress.value.pct)}%)
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
