// ============================================================
// 角色扮演 - 角色个人主页弹窗（参照主流 IM 软件个人名片设计）
// ============================================================
import { createPortal } from "react-dom";
import { Icons } from "./Icons";
import { getRoleName, getGenderName } from "../utils/characterRoles";
import type { CharacterInfo } from "../types";

interface RoleplayProfileModalProps {
	character: CharacterInfo;
	isMobile: boolean;
	onClose: () => void;
}

/** 单条属性项（基本信息网格） */
const ProfileItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
	<div className="profile-grid-item">
		<span className="profile-grid-label">{label}</span>
		<span className="profile-grid-value" title={value}>
			{value}
		</span>
	</div>
);

export const RoleplayProfileModal: React.FC<RoleplayProfileModalProps> = ({
	character,
	isMobile,
	onClose,
}) => {
	const basicItems: Array<{ label: string; value?: string }> = [
		{ label: "年龄", value: character.age },
		{ label: "身份", value: character.identity },
		{ label: "地位", value: character.socialStatus },
		{ label: "性格", value: character.personality },
		{ label: "外貌", value: character.appearance },
		{ label: "出身", value: character.background },
		{ label: "弧光", value: character.characterArc },
	];
	const hasBasic = basicItems.some((it) => it.value);
	const hasTags = (character.aliases?.length ?? 0) > 0 || (character.relationTerms?.length ?? 0) > 0;
	const hasVoice = Boolean(character.voice || character.voiceDesignPrompt || character.dialect);

	return createPortal(
		<div
			className={`modal-overlay roleplay-profile-overlay${isMobile ? " mobile" : ""}`}
			onClick={onClose}
		>
			<div
				className={`roleplay-profile${isMobile ? " mobile" : ""}`}
				onClick={(e) => e.stopPropagation()}
			>
				{/* 顶部渐变区：大头像 + 名字 + 徽章 */}
				<div className="profile-hero">
					<button className="profile-close-btn" onClick={onClose} aria-label="关闭">
						<Icons.x size={16} />
					</button>
					<span className={`profile-hero-avatar ${character.gender}`}>
						<span className="profile-hero-avatar-text">{character.name.charAt(0)}</span>
					</span>
					<div className="profile-hero-name">{character.name}</div>
					<div className="profile-hero-badges">
						<span className={`gender-badge ${character.gender}`}>
							{getGenderName(character.gender)}
						</span>
						<span className="role-badge">{getRoleName(character.role)}</span>
					</div>
				</div>

				{/* 资料详情 */}
				<div className="profile-body">
					{hasBasic && (
						<div className="profile-section">
							<div className="profile-section-title">基本信息</div>
							<div className="profile-grid">
								{basicItems.map(
									(it) =>
										it.value && <ProfileItem key={it.label} label={it.label} value={it.value} />,
								)}
							</div>
						</div>
					)}

					{hasTags && (
						<div className="profile-section">
							{character.aliases && character.aliases.length > 0 && (
								<div className="profile-tag-row">
									<span className="profile-tag-label">别称</span>
									<div className="tags-list">
										{character.aliases.map((alias, i) => (
											<span key={i} className="alias-badge">
												{alias}
											</span>
										))}
									</div>
								</div>
							)}
							{character.relationTerms && character.relationTerms.length > 0 && (
								<div className="profile-tag-row">
									<span className="profile-tag-label">代称</span>
									<div className="tags-list">
										{character.relationTerms.map((term, i) => (
											<span key={i} className="relation-badge">
												{term}
											</span>
										))}
									</div>
								</div>
							)}
						</div>
					)}

					{hasVoice && (
						<div className="profile-section">
							<div className="profile-section-title">声音</div>
							<div className="profile-grid">
								{character.voice && <ProfileItem label="音色" value={character.voice} />}
								{character.dialect && <ProfileItem label="方言" value={character.dialect} />}
							</div>
							{character.voiceDesignPrompt && (
								<div className="profile-notes">{character.voiceDesignPrompt}</div>
							)}
						</div>
					)}

					{character.notes && (
						<div className="profile-section">
							<div className="profile-section-title">角色小传</div>
							<div className="profile-notes">{character.notes}</div>
						</div>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
};
