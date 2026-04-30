interface EmptyStateProps {
	icon: string;
	message: string;
	hint?: string;
	className?: string;
}

export function EmptyState({
	icon,
	message,
	hint,
	className = "",
}: EmptyStateProps) {
	return (
		<div className={`empty-state ${className}`}>
			<span className="empty-state-icon">{icon}</span>
			<p className="empty-state-message">{message}</p>
			{hint && <p className="empty-state-hint">{hint}</p>}
		</div>
	);
}
