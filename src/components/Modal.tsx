// ============================================================
// 通用弹窗外壳组件 — 统一 modal-overlay / config-header / 关闭按钮
// ============================================================
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

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

/** 通用弹窗底部操作栏 */
function ModalFooter({ children, className }: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={className ?? "character-actions-fab-wrapper"}>
			{children}
		</div>
	);
}

/** 通用弹窗外壳：遮罩 + 标题栏（图标 + 标题 + 关闭按钮） */
export function Modal({ open, onClose, title, icon, className, bodyClassName, children, footer, portal = true, overlayClassName, size, hideHeader }: {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	icon?: ReactNode;
	/** 弹窗内容容器 className，默认 "config-modal"（传入则完全替换） */
	className?: string;
	/** 内容区域 className，默认 "config-body" */
	bodyClassName?: string;
	children: ReactNode;
	/** 底部操作栏内容（渲染为 character-actions-fab-wrapper） */
	footer?: ReactNode;
	/** 是否使用 createPortal 渲染到 body（默认 true，弹窗通常需要） */
	portal?: boolean;
	/** 遮罩层额外 className */
	overlayClassName?: string;
	/** 尺寸变体："sm" 为小弹窗 */
	size?: "sm";
	/** 隐藏标题栏（用于名片卡等自带头部的自定义布局，关闭按钮需自行渲染） */
	hideHeader?: boolean;
}) {
	if (!open) return null;

	const modalClass = size === "sm" ? "config-modal config-modal-sm" : (className ?? "config-modal");
	const overlayCls = overlayClassName ? `modal-overlay ${overlayClassName}` : "modal-overlay";

	const content = (
		<div className={overlayCls} onClick={onClose}>
			<div className={modalClass} onClick={(e) => e.stopPropagation()}>
				{!hideHeader && (
					<div className="config-header">
						<div className="config-title">
							{icon && <span className="title-icon">{icon}</span>}
							<span>{title}</span>
						</div>
						<CloseButton onClick={onClose} />
					</div>
				)}
				<div className={bodyClassName ?? "config-body"}>
					{children}
				</div>
				{footer && <ModalFooter>{footer}</ModalFooter>}
			</div>
		</div>
	);

	return portal ? createPortal(content, document.body) : content;
}
