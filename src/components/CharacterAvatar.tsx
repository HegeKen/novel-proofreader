// ============================================================
// 角色头像：性别渐变圆 + 名字首字；角色缺失时显示占位文字
// ============================================================
import type { CharacterInfo } from "../types";

interface CharacterAvatarProps {
	character?: CharacterInfo | null;
	/** 尺寸/场景样式类，如 avatar-circle、avatar-circle-sm、roleplay-msg-avatar */
	className: string;
	/** 无角色时显示的占位文字 */
	fallback?: string;
	/** 无角色时的性别兜底类（默认 other） */
	fallbackClass?: string;
	/** 名字首字的文字样式类（不传则直接渲染文字，不包裹 span） */
	textClassName?: string;
	onClick?: (e: React.MouseEvent) => void;
}

export function CharacterAvatar({
	character,
	className,
	fallback = "?",
	fallbackClass = "other",
	textClassName,
	onClick,
}: CharacterAvatarProps) {
	const text = character ? character.name.charAt(0) : fallback;
	return (
		<span
			className={`${className} ${character ? character.gender : fallbackClass}${onClick ? " clickable" : ""}`}
			onClick={onClick}
		>
			{textClassName ? <span className={textClassName}>{text}</span> : text}
		</span>
	);
}
