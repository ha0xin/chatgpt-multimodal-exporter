import { useState } from 'preact/hooks';
import { formatBytes } from '../../utils';
import { FileCandidate } from '../../types';

interface FilePreviewDialogProps {
    candidates: FileCandidate[];
    onConfirm: (selected: FileCandidate[]) => void;
    onClose: () => void;
}

export function FilePreviewDialog({ candidates, onConfirm, onClose }: FilePreviewDialogProps) {
    // Default all selected
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
        new Set(candidates.map((_, i) => i))
    );

    const toggleSelect = (idx: number) => {
        const next = new Set(selectedIndices);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        setSelectedIndices(next);
    };

    const toggleAll = () => {
        if (selectedIndices.size === candidates.length) {
            setSelectedIndices(new Set());
        } else {
            setSelectedIndices(new Set(candidates.map((_, i) => i)));
        }
    };

    const handleConfirm = () => {
        const selected = candidates.filter((_, i) => selectedIndices.has(i));
        if (selected.length === 0) {
            alert('请至少选择一个文件');
            return;
        }
        onConfirm(selected);
        onClose();
    };

    return (
        <div className="cgptx-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="cgptx-modal-box">
                <div className="cgptx-modal-header">
                    <div className="cgptx-modal-title">
                        可下载文件 ({candidates.length})
                    </div>
                    <div className="cgptx-modal-actions">
                        <button className="cgptx-btn" onClick={toggleAll}>
                            全选/反选
                        </button>
                        <button className="cgptx-btn primary" onClick={handleConfirm}>
                            下载选中
                        </button>
                        <button className="cgptx-btn" onClick={onClose}>
                            关闭
                        </button>
                    </div>
                </div>

                <div className="cgptx-list">
                    {candidates.map((info, idx) => {
                        const name = (info.meta && (info.meta.name || info.meta.file_name)) || info.file_id || info.pointer || '未命名';
                        const mime = (info.meta && (info.meta.mime_type || info.meta.file_type)) || (info.meta && info.meta.mime) || '';
                        const size = info.meta?.size_bytes || info.meta?.size || info.meta?.file_size || info.meta?.file_size_bytes || null;

                        const metaParts = [];
                        metaParts.push(`来源: ${info.source || '未知'}`);
                        if (info.file_id) metaParts.push(`file_id: ${info.file_id}`);
                        if (info.pointer && info.pointer !== info.file_id) metaParts.push(`pointer: ${info.pointer}`);
                        if (mime) metaParts.push(`mime: ${mime}`);
                        if (size) metaParts.push(`大小: ${formatBytes(size)}`);

                        return (
                            <div className="cgptx-item" key={idx}>
                                <input
                                    type="checkbox"
                                    checked={selectedIndices.has(idx)}
                                    onChange={() => toggleSelect(idx)}
                                />
                                <div></div>
                                <div>
                                    <div className="title">{name}</div>
                                    <div className="meta">{metaParts.join(' • ')}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="cgptx-modal-actions" style={{ justifyContent: 'flex-end' }}>
                    <div className="cgptx-chip">
                        点击“下载选中”将按列表顺序依次下载（含 /files 和 CDN 指针）
                    </div>
                </div>
            </div>
        </div>
    );
}
