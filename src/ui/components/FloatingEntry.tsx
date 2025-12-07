import { useEffect, useRef } from 'preact/hooks';
import { getRootHandle, startAutoSaveLoop } from '../../autoSave';
import { Cred } from '../../cred';
import { useCredentialStatus } from '../hooks/useCredentialStatus';
import { useAutoSave } from '../hooks/useAutoSave';
import { StatusPanel } from './StatusPanel';
import { ExportJsonButton } from './ExportJsonButton';
import { DownloadFilesButton } from './DownloadFilesButton';
import { ActionButtons } from './ActionButtons';
import { Conversation } from '../../types';

export function FloatingEntry() {
  const { status, refreshCredStatus } = useCredentialStatus();
  // Use new hook
  const autoSaveState = useAutoSave();

  // Shared cache for conversation data to optimize fetches between buttons
  const lastConvData = useRef<Conversation | null>(null);

  const updateCache = (data: Conversation) => {
    lastConvData.current = data;
  };

  useEffect(() => {
    // Auto-start loop if handle exists
    getRootHandle().then(async (h) => {
      if (h) {
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
    <div className="cgptx-mini-wrap">
      <StatusPanel status={status} isOk={isOk} />
      <div className="cgptx-mini-btn-row">
        <ExportJsonButton
          refreshCredStatus={refreshCredStatus}
          onDataFetched={updateCache}
        />
        <DownloadFilesButton
          refreshCredStatus={refreshCredStatus}
          cachedData={lastConvData.current}
          onDataFetched={updateCache}
        />
        <ActionButtons autoSaveState={autoSaveState} />
      </div>
    </div>
  );
}
