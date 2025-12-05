import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
    return (
        <SonnerToaster
            position="top-center"
            richColors
            toastOptions={{
                style: {
                    background: '#fff',
                    border: '1px solid #e5e7eb',
                    color: '#374151',
                    fontSize: '14px',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                },
                className: 'cgptx-toast',
            }}
        />
    );
}
