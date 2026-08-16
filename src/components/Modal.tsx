// ============================================================
// 通用弹窗外壳组件 — 统一 modal-overlay / config-header / 关闭按钮
// ============================================================
import type { ReactNode } from "react";

/** 通用关闭按钮（替换各组件手写的 SVG） */
export function CloseButton({ onClick, size = 16, className }: {
	onClick: () => void;
	size?: number;
	className?: string;
}) {
	return (
		<button className={className ?? "close-btn"} onClick={onClick} aria-label="关闭">
			<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
				<path d="M3 3L13 13M13 3L3 13" />
			</svg>
		</button>
	);
}

/** 通用弹窗外壳：遮罩 + 标题栏（图标 + 标题 + 关闭按钮） */
export function Modal({ open, onClose, title, icon, className, children }: {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	icon?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	if (!open) return null;
	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className={className ?? "config-modal"} onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						{icon && <span className="title-icon">{icon}</span>}
						<span>{title}</span>
					</div>
					<CloseButton onClick={onClose} />
				</div>
				{children}
			</div>
		</div>
	);
}
