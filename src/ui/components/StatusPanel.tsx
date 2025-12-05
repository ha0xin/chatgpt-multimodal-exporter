import { useState, useEffect } from 'preact/hooks';
import { Cred } from '../../cred';
import { CredStatus } from '../hooks/useCredentialStatus';

interface StatusPanelProps {
	status: CredStatus;
	isOk: boolean;
}

export function StatusPanel({ status, isOk }: StatusPanelProps) {
	const [workspaceInfo, setWorkspaceInfo] = useState('Checking...');

	useEffect(() => {
		const updateWs = () => {
			if (!status.hasAcc) {
				setWorkspaceInfo('Checking...');
				return;
			}

			const acc = Cred.accountId;
			if (acc) {
				const workspaceType = acc === 'personal' ? 'Personal' : 'Team'
				setWorkspaceInfo('Workspace: ' + workspaceType);
			}
		};
		updateWs();
	}, [status.hasAcc]);

	return (
		<div className="cgptx-mini-badges-col">
			<div
				className={`cgptx-mini-badge ${isOk ? 'ok' : 'bad'}`}
				id="cgptx-mini-badge"
				title={status.debug}
			>
				{`Token: ${status.hasToken ? '✔' : '✖'} / Account id: ${status.hasAcc ? '✔' : '✖'}`}
			</div>
			<div className="cgptx-mini-badge info" title="Current Workspace Context">
				{workspaceInfo}
			</div>
			{status.userLabel && (
				<div className="cgptx-mini-badge info" title="Current User" style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					User: {status.userLabel}
				</div>
			)}

		</div>
	);
}
