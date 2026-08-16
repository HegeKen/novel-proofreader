import type { CharacterInfo, NovelEvent } from "../../types";
import { Icons } from "../Icons";
import { getRoleName, getGenderName } from "../../utils/characterRoles";

interface CharacterCardProps {
	character: CharacterInfo;
	isExpanded: boolean;
	isEditing: boolean;
	isReanalyzing: boolean;
	playingNoteId: string | null;
	voiceOptions: Array<{ value: string; label: string }>;
	allEvents: NovelEvent[];
	onToggleExpand: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onReanalyzeBiography: () => void;
	onPlayNote: () => void;
}

export function CharacterCard({
	character,
	isExpanded,
	isEditing,
	isReanalyzing,
	playingNoteId,
	voiceOptions,
	allEvents,
	onToggleExpand,
	onEdit,
	onDelete,
	onReanalyzeBiography,
	onPlayNote,
}: CharacterCardProps) {
	if (isEditing) {
		return null;
	}

	return (
		<div className={`character-card ${isExpanded ? 'expanded' : ''}`}>
			<div className="character-card-content">
				<div className="character-main-section" onClick={onToggleExpand} style={{ cursor: 'pointer' }}>
					<div className="character-avatar">
						<div className={`avatar-circle ${character.gender}`}>
							<span className="avatar-text">{character.name.charAt(0)}</span>
						</div>
					</div>

					<div className="character-info">
						<div className="character-header">
							<h3 className="character-name">{character.name}</h3>
							<span className={`gender-badge ${character.gender}`}>
								{getGenderName(character.gender)}
							</span>
							{character.role && (
								<span className="role-badge">
									{getRoleName(character.role)}
								</span>
							)}
						</div>
					</div>

					<div className="character-actions">
						<button
							className="action-btn delete"
							onClick={(e) => { e.stopPropagation(); onDelete(); }}
							title="删除"
						>
							<Icons.trash2 size={16} />
						</button>
						<button
							className="action-btn edit"
							onClick={(e) => { e.stopPropagation(); onEdit(); }}
							title="编辑"
						>
							<Icons.userRoundPen size={18} />
						</button>
						<button
							className="action-btn expend"
							title="展开/折叠"
						>
							<Icons.chevronDown size={16} style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
						</button>
					</div>
				</div>

				{isExpanded && (<>
					{(character.voiceDesignPrompt || character.voice || character.dialect) && (
						<div className="character-tags-section">
							{(character.voiceDesignPrompt || character.voice) && (
								<div className="detail-item voice-design-detail">
									<Icons.sparkle size={14} />
									<span className="detail-label">音色设计:</span>
									<span className="profile-value" title={character.voiceDesignPrompt || character.voice}>
										{character.voiceDesignPrompt || (character.voice ? voiceOptions.find(o => o.value === character.voice)?.label || character.voice : "")}
									</span>
								</div>
							)}
							{character.dialect && (
								<div className="detail-item dialect-detail">
									<Icons.globe size={14} />
									<span className="detail-label">方言:</span>
									<span className="profile-value">{character.dialect}</span>
								</div>
							)}
						</div>
					)}

					{((character.aliases && character.aliases.length > 0) || (character.relationTerms && character.relationTerms.length > 0)) && (
						<div className="character-tags-section">
							{(character.aliases && character.aliases.length > 0) && (
								<div className="detail-item aliases">
									<span className="detail-label">别称:</span>
									<div className="tags-list">
										{character.aliases.map((alias, index) => (
											<span key={index} className="alias-badge">{alias}</span>
										))}
									</div>
								</div>
							)}
							{(character.relationTerms && character.relationTerms.length > 0) && (
								<div className="detail-item relations">
									<span className="detail-label">代称:</span>
									<div className="tags-list">
										{character.relationTerms.map((term, index) => (
											<span key={index} className="relation-badge">{term}</span>
										))}
									</div>
								</div>
							)}
						</div>
					)}

					{(character.age || character.identity || character.socialStatus || character.personality || character.appearance || character.background || character.characterArc) && (
						<div className="character-profile-section">
							<div className="profile-grid">
								{character.age && (
									<div className="profile-item">
										<span className="profile-label">年龄</span>
										<span className="profile-value">{character.age}</span>
									</div>
								)}
								{character.identity && (
									<div className="profile-item">
										<span className="profile-label">身份</span>
										<span className="profile-value">{character.identity}</span>
									</div>
								)}
								{character.socialStatus && (
									<div className="profile-item">
										<span className="profile-label">地位</span>
										<span className="profile-value">{character.socialStatus}</span>
									</div>
								)}
								{character.personality && (
									<div className="profile-item">
										<span className="profile-label">性格</span>
										<span className="profile-value">{character.personality}</span>
									</div>
								)}
								{character.appearance && (
									<div className="profile-item">
										<span className="profile-label">外貌</span>
										<span className="profile-value">{character.appearance}</span>
									</div>
								)}
								{character.background && (
									<div className="profile-item">
										<span className="profile-label">出身</span>
										<span className="profile-value">{character.background}</span>
									</div>
								)}
								{character.characterArc && (
									<div className="profile-item">
										<span className="profile-label">弧光</span>
										<span className="profile-value">{character.characterArc}</span>
									</div>
								)}
							</div>
						</div>
					)}

					{(() => {
						const charEvents = allEvents
							.filter((evt) => evt.involvedCharacterIds.includes(character.id))
							.sort((a, b) => a.timeOrder - b.timeOrder);
						if (charEvents.length === 0) return null;
						return (
							<div className="character-major-events-section">
								<div className="events-label">
									<Icons.list size={14} />
									角色大事件
								</div>
								<div className="events-timeline">
									{charEvents.map((evt) => (
										<div key={evt.id} className="events-timeline-item">
											<div className="events-timeline-dot" />
											<div className="events-timeline-body">
												<div className="events-timeline-title">{evt.title}</div>
												{(evt.chapter || evt.timeInfo) && (
													<div className="events-timeline-meta">
														{evt.chapter && (
															<span className="events-timeline-chapter">{evt.chapter}</span>
														)}
														{evt.timeInfo && (
															<span className="events-timeline-time">{evt.timeInfo}</span>
														)}
													</div>
												)}
												{evt.description && (
													<div className="events-timeline-desc">{evt.description}</div>
												)}
											</div>
										</div>
									))}
								</div>
							</div>
						);
					})()}

					{character.notes && (
						<div className="character-notes-section">
							<div className="notes-label">
								<div className="notes-label-left">
									<Icons.punctuation size={14} />
									备注
								</div>
								<div className="notes-label-right">
									<button
										className="notes-refresh-btn"
										onClick={(e) => { e.stopPropagation(); onReanalyzeBiography(); }}
										title="重新分析角色小传"
										disabled={isReanalyzing}
									>
										{isReanalyzing ? <Icons.loader2 size={14} className="animate-spin" /> : <Icons.refreshCw size={14} />}
									</button>
									<button
										className={`notes-play-btn ${playingNoteId === character.id ? 'playing' : ''}`}
										onClick={(e) => { e.stopPropagation(); onPlayNote(); }}
										title={playingNoteId === character.id ? '停止播放' : '播放备注'}
									>
										{playingNoteId === character.id ? (
											<Icons.pause size={14} />
										) : (
											<Icons.volume size={14} />
										)}
									</button>
								</div>
							</div>
							<div className="notes-content">{character.notes}</div>
						</div>
					)}
				</>)}
			</div>
		</div>
	);
}