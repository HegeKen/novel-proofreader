import { useEffect, useRef } from "react";
import { Icons } from "./Icons";

export interface ToastMessage {
	id: string;
	type: "success" | "error" | "warning" | "info";
	message: string;
	duration?: number;
}

interface ToastProps {
	message: ToastMessage;
	onClose: (id: string) => void;
}

function ToastItem({ message, onClose }: ToastProps) {
	const duration = message.duration || 3000;
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		timerRef.current = setTimeout(() => {
			onClose(message.id);
		}, duration);
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, [message.id, duration, onClose]);

	const handleClose = () => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}
		onClose(message.id);
	};

	const iconMap = {
		success: Icons.check,
		error: Icons.error,
		warning: Icons.error,
		info: Icons.sparkle,
	};

	const colorMap = {
		success: "var(--green)",
		error: "var(--red)",
		warning: "var(--yellow)",
		info: "var(--accent)",
	};

	const IconComponent = iconMap[message.type];

	return (
		<div
			className="toast-item"
			style={{ "--toast-color": colorMap[message.type] } as React.CSSProperties}
		>
			{IconComponent && <IconComponent size={16} />}
			<span className="toast-message">{message.message}</span>
			<button type="button" className="toast-close" onClick={handleClose}>
				<Icons.close size={14} />
			</button>
		</div>
	);
}

interface ToastContainerProps {
	messages: ToastMessage[];
	onClose: (id: string) => void;
}

export function ToastContainer({ messages, onClose }: ToastContainerProps) {
	if (messages.length === 0) return null;

	return (
		<div className="toast-container">
			{messages.map((msg) => (
				<ToastItem key={msg.id} message={msg} onClose={onClose} />
			))}
		</div>
	);
}
