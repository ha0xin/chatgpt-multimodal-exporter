import { useState, useEffect, useRef } from 'preact/hooks';
import { subscribeStatus, getRootHandle, startAutoSaveLoop, AutoSaveStatus } from '../../autoSave';
import { useCredentialStatus } from '../hooks/useCredentialStatus';
import { StatusPanel } from './StatusPanel';
import { ExportJsonButton } from './ExportJsonButton';
import { DownloadFilesButton } from './DownloadFilesButton';
import { ActionButtons } from './ActionButtons';
import { Conversation } from '../../types';

export function FloatingEntry() {
  const { status, refreshCredStatus } = useCredentialStatus();
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>({ lastRun: 0, state: 'idle', message: '' });

  // Shared cache for conversation data to optimize fetches between buttons
  const lastConvData = useRef<Conversation | null>(null);

  const updateCache = (data: Conversation) => {
    lastConvData.current = data;
  };

  useEffect(() => {
    // Auto-start loop if handle exists
    getRootHandle().then(h => {
      if (h) startAutoSaveLoop();
    });
    return subscribeStatus(setAutoSaveStatus);
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
        <ActionButtons autoSaveStatus={autoSaveStatus} />
      </div>
    </div>
  );
}
