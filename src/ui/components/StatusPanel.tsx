import { CredStatus } from '../hooks/useCredentialStatus';

interface StatusPanelProps {
	status: CredStatus;
	isOk: boolean;
}

export function StatusPanel({ status, isOk }: StatusPanelProps) {
	// Only show if there is an issue to minimize noise, or just a subtle indicator
	const title = `Token: ${status.hasToken ? '✔' : '✖'} / Account: ${status.hasAcc ? '✔' : '✖'}${status.userLabel ? ` / User: ${status.userLabel}` : ''}`;
	
	return (
		<div className="cgptx-mini-badges-col">
			<div
				className={`cgptx-mini-badge ${isOk ? 'ok' : 'bad'}`}
				title={title}
			/>
		</div>
	);
}
