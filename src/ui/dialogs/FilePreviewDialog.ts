import { render, h } from 'preact';
import { FileCandidate } from '../../types';
import { FilePreviewDialog } from '../components/FilePreviewDialog';

export function showFilePreviewDialog(candidates: FileCandidate[], onConfirm: (selected: FileCandidate[]) => void) {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const close = () => {
        render(null, root);
        root.remove();
    };

    render(h(FilePreviewDialog, {
        candidates,
        onConfirm,
        onClose: close
    }), root);
}
