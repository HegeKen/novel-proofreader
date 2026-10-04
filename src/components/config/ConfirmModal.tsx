// ============================================================
// 通用确认弹窗 — 基于 Modal 外壳，替代原生 window.confirm
// ============================================================
import React from "react";
import { Icons } from "../Icons";
import { Modal } from "../Modal";

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
	return (
		<Modal
			open={show}
			onClose={onCancel}
			title={title}
			icon={danger ? <Icons.alertTriangle size={16} /> : <Icons.circle size={16} />}
			size="sm"
			footer={
				<>
					<button className="btn" onClick={onCancel}>
						{cancelText}
					</button>
					<button className={`btn ${danger ? "btn-danger" : ""}`} onClick={onConfirm}>
						{confirmText}
					</button>
				</>
			}
		>
			<p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, margin: 0 }}>{message}</p>
		</Modal>
	);
};
