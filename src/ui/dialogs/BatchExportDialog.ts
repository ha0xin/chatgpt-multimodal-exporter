import { render, h } from 'preact';
import { BatchExportDialog } from '../components/BatchExportDialog';

export function showBatchExportDialog() {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const close = () => {
        render(null, root);
        root.remove();
    };

    render(h(BatchExportDialog, {
        onClose: close
    }), root);
}
