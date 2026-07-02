import React from "react";
import { createPortal } from "react-dom";
import { Icons } from "../Icons";

interface ConfirmModalProps {
	show: boolean;
	title?: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	danger?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
	show,
	title = "确认操作",
	message,
	confirmText = "确定",
	cancelText = "取消",
	danger = false,
	onConfirm,
	onCancel,
}) => {
	if (!show) return null;

	return createPortal(
		<div className="modal-overlay" onClick={onCancel}>
			<div className="config-modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon">
							{danger ? <Icons.alertTriangle size={16} /> : <Icons.circle size={16} />}
						</span>
						<span>{title}</span>
					</div>
					<button className="close-btn" onClick={onCancel}>
						<Icons.x size={16} />
					</button>
				</div>
				<div className="config-body">
					<p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, margin: 0 }}>{message}</p>
				</div>
				<div className="config-footer">
					<button
						className="btn"
						onClick={onCancel}
					>
						{cancelText}
					</button>
					<button
						className={`btn ${danger ? "btn-danger" : "btn"}`}
						onClick={onConfirm}
					>
						{confirmText}
					</button>
				</div>
			</div>
		</div>,
		document.body
	);
};
