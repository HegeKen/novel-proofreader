// ============================================================
// 响应式按钮组件 — 自动适配移动端（仅图标）与桌面端（图标+文字）
// ============================================================
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { useMobile } from "../hooks/useMobile";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** 按钮变体 */
	variant?: "default" | "primary" | "secondary" | "outline" | "danger";
	/** 按钮图标（移动端始终显示） */
	icon?: ReactNode;
	/** 是否强制隐藏文字（覆盖移动端默认行为） */
	hideText?: boolean;
	/** 是否强制显示文字（覆盖移动端默认行为） */
	showText?: boolean;
}

/** 响应式按钮：移动端自动隐藏文字仅保留图标 */
export function Button({
	variant = "default",
	icon,
	children,
	hideText,
	showText,
	className,
	...props
}: ButtonProps) {
	const { isMobile } = useMobile();
	const shouldHideText = hideText ?? (isMobile && !showText);

	const variantClass =
		variant === "primary"
			? "btn-primary"
			: variant === "secondary"
				? "btn-secondary"
				: variant === "outline"
					? "btn-outline"
					: variant === "danger"
						? "btn-danger"
						: "";

	const mobileClass = isMobile ? "btn-mobile" : "";
	const combinedClass = ["btn", variantClass, mobileClass, className]
		.filter(Boolean)
		.join(" ");

	return (
		<button className={combinedClass} {...props}>
			{icon}
			{children && !shouldHideText && <span>{children}</span>}
		</button>
	);
}
