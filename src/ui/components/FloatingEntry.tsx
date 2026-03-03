import { useEffect, useState } from 'preact/hooks';
import { getRootHandle, startAutoSaveLoop } from '../../autoSave';
import { Cred } from '../../cred';
import { useCredentialStatus } from '../hooks/useCredentialStatus';
import { useAutoSave } from '../hooks/useAutoSave';
import { StatusPanel } from './StatusPanel';
import { ExportJsonButton } from './ExportJsonButton';
import { DownloadFilesButton } from './DownloadFilesButton';
import { ActionButtons } from './ActionButtons';
import { Conversation } from '../../types';

interface FloatingEntryProps {
  collapsed?: boolean;
}

export function FloatingEntry({ collapsed = false }: FloatingEntryProps) {
  const { status, refreshCredStatus } = useCredentialStatus();
  // Use new hook
  const autoSaveState = useAutoSave();

  // Shared cache for conversation data to optimize fetches between buttons.
  // Use state so updates are reactive and sibling buttons receive fresh data.
  const [lastConvData, setLastConvData] = useState<Conversation | null>(null);

  const updateCache = (data: Conversation) => {
    setLastConvData(data);
  };

  useEffect(() => {
    // Auto-start loop if handle exists
    // Auto-start loop if handle exists and enabled
    getRootHandle().then(async (h) => {
      if (h) {
         // Check explicit setting
         const storedEnabled = localStorage.getItem('chatgpt_exporter_autosave_enabled');
         // Default to true if not set (legacy behavior compatibility)
         const isEnabled = storedEnabled === null || storedEnabled === 'true';

         if (!isEnabled) {
             console.log('AutoSave is disabled by user setting.');
             return;
         }

        // Wait for credentials before starting the loop
        const credReady = await Cred.ensureReady();
        if (credReady) {
            // Note: startAutoSaveLoop is now safe to call multiple times (idempotent init)
            startAutoSaveLoop();
        } else {
          console.warn('AutoSave not started: User credentials not ready');
        }
      }
    });
    // Removed subscribeStatus, useAutoSave handles it via signals
  }, []);

  const isOk = status.hasToken && status.hasAcc;

  return (
    <div className={`cgptx-mini-wrap${collapsed ? ' cgptx-mini-wrap-collapsed' : ''}`}>
      <StatusPanel status={status} isOk={isOk} />
      {!collapsed && (
        <div className="cgptx-mini-btn-row">
          <ExportJsonButton
            refreshCredStatus={refreshCredStatus}
            onDataFetched={updateCache}
          />
          <DownloadFilesButton
            refreshCredStatus={refreshCredStatus}
            cachedData={lastConvData}
            onDataFetched={updateCache}
          />
          <ActionButtons autoSaveState={autoSaveState} />
        </div>
      )}
    </div>
  );
}
