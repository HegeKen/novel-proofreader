import type { CharacterInfo, CharacterRole } from "../../types";
import { Icons } from "../Icons";
import { Select } from "../Select";

interface CharacterEditFormProps {
	novelId: string;
	editForm: Partial<CharacterInfo>;
	voiceOptions: Array<{ value: string; label: string }>;
	dialectOptions: Array<{ value: string; label: string }>;
	newAlias: string;
	newRelationTerm: string;
	isGeneratingVoiceDesign: boolean;
	isEnhancingCharacter: boolean;
	onFormChange: (form: Partial<CharacterInfo>) => void;
	onNewAliasChange: (value: string) => void;
	onNewRelationTermChange: (value: string) => void;
	onAddAlias: () => void;
	onRemoveAlias: (index: number) => void;
	onClearAllAliases: () => void;
	onAddRelationTerm: () => void;
	onRemoveRelationTerm: (index: number) => void;
	onClearAllRelationTerms: () => void;
	onSave: () => void;
	onCancel: () => void;
	onGenerateVoiceDesign: () => void;
	onEnhanceCharacter: () => void;
	onShowEventModal: () => void;
}

export function CharacterEditForm({
	editForm,
	voiceOptions,
	dialectOptions,
	newAlias,
	newRelationTerm,
	isGeneratingVoiceDesign,
	isEnhancingCharacter,
	onFormChange,
	onNewAliasChange,
	onNewRelationTermChange,
	onAddAlias,
	onRemoveAlias,
	onClearAllAliases,
	onAddRelationTerm,
	onRemoveRelationTerm,
	onClearAllRelationTerms,
	onSave,
	onCancel,
	onGenerateVoiceDesign,
	onEnhanceCharacter,
	onShowEventModal,
}: CharacterEditFormProps) {
	return (
		<div className="character-card editing">
			<div className="space-y-3">
				<div className="form-field">
					<label>角色名</label>
					<input
						type="text"
						value={editForm.name || ""}
						onChange={(e) => onFormChange({ ...editForm, name: e.target.value })}
						className="config-input"
					/>
				</div>
				<div className="grid grid-cols-2 gap-3">
					<div className="form-field">
						<label>性别</label>
						<Select
							value={editForm.gender || "other"}
							onChange={(v) => onFormChange({ ...editForm, gender: v as "male" | "female" | "other" })}
							options={[
								{ value: "male", label: "男" },
								{ value: "female", label: "女" },
								{ value: "other", label: "其他" },
							]}
						/>
					</div>
					<div className="form-field">
						<label>角色类型</label>
						<Select
							value={editForm.role || ""}
							onChange={(v) => onFormChange({ ...editForm, role: v ? (v as CharacterRole) : undefined })}
							options={[
								{ value: "", label: "未设置" },
								{ value: "protagonist", label: "男主" },
								{ value: "heroine", label: "女主" },
								{ value: "antagonist", label: "反派" },
								{ value: "supportingMale", label: "男配" },
								{ value: "supportingFemale", label: "女配" },
								{ value: "mentor", label: "导师" },
								{ value: "rival", label: "对手" },
								{ value: "loveInterest", label: "爱慕对象" },
								{ value: "family", label: "家人" },
								{ value: "friend", label: "朋友" },
								{ value: "npc", label: "NPC" },
							]}
						/>
					</div>
				</div>
				<div className="form-field">
					<div className="flex justify-between items-center mb-2">
						<label className="text-xs">音色设计</label>
						<button
							type="button"
							className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
							onClick={onGenerateVoiceDesign}
							disabled={isGeneratingVoiceDesign || !editForm.name}
						>
							<Icons.sparkle size={12} />
							{isGeneratingVoiceDesign ? "生成中..." : "AI生成"}
						</button>
					</div>
					<Select
						value={editForm.voice || ""}
						onChange={(v) => onFormChange({ ...editForm, voice: v })}
						options={[{ value: "", label: "选择预设音色" }, ...voiceOptions]}
						className="mb-2"
					/>
					<textarea
						value={editForm.voiceDesignPrompt || ""}
						onChange={(e) => onFormChange({ ...editForm, voiceDesignPrompt: e.target.value })}
						className="config-input"
						placeholder="输入音色设计描述（优先使用），如：温柔甜美，年轻女性，温婉知性..."
						rows={3}
					/>
				</div>

				<div className="form-field">
					<label>方言</label>
					<Select
						value={editForm.dialect || ""}
						onChange={(v) => onFormChange({ ...editForm, dialect: v })}
						options={dialectOptions}
					/>
				</div>

				<div className="form-field">
					<div className="flex justify-between items-center mb-2">
						<label className="text-xs">别称</label>
						{((editForm.aliases || []).length > 0) && (
							<button
								type="button"
								className="text-xs text-red-500 hover:text-red-400"
								onClick={onClearAllAliases}
							>
								清空全部
							</button>
						)}
					</div>
					<div className="flex gap-2 mb-2">
						<input
							type="text"
							value={newAlias}
							onChange={(e) => onNewAliasChange(e.target.value)}
							onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), onAddAlias())}
							placeholder="输入后按回车"
							className="config-input flex-1"
						/>
						<button
							type="button"
							className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white"
							onClick={onAddAlias}
						>
							<Icons.plus size={12} />
						</button>
					</div>
					{((editForm.aliases || []).length > 0) && (
						<div className="flex flex-wrap gap-1">
							{(editForm.aliases || []).map((alias, index) => (
								<span key={index} className="alias-tag text-xs">
									{alias}
									<button
										type="button"
										className="remove-btn"
										onClick={() => onRemoveAlias(index)}
									>
										×
									</button>
								</span>
							))}
						</div>
					)}
				</div>

				<div className="form-field">
					<div className="flex justify-between items-center mb-2">
						<label className="text-xs">关系代称</label>
						{((editForm.relationTerms || []).length > 0) && (
							<button
								type="button"
								className="text-xs text-red-500 hover:text-red-400"
								onClick={onClearAllRelationTerms}
							>
								清空全部
							</button>
						)}
					</div>
					<div className="flex gap-2 mb-2">
						<input
							type="text"
							value={newRelationTerm}
							onChange={(e) => onNewRelationTermChange(e.target.value)}
							onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), onAddRelationTerm())}
							placeholder="输入后按回车"
							className="config-input flex-1"
						/>
						<button
							type="button"
							className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs text-white"
							onClick={onAddRelationTerm}
						>
							<Icons.plus size={12} />
						</button>
					</div>
					{((editForm.relationTerms || []).length > 0) && (
						<div className="flex flex-wrap gap-1">
							{(editForm.relationTerms || []).map((term, index) => (
								<span key={index} className="relation-tag text-xs">
									{term}
									<button
										type="button"
										className="remove-btn"
										onClick={() => onRemoveRelationTerm(index)}
									>
										×
									</button>
								</span>
							))}
						</div>
					)}
				</div>

				<div className="form-field">
					<label>年龄</label>
					<input
						type="text"
						value={editForm.age || ""}
						onChange={(e) => onFormChange({ ...editForm, age: e.target.value })}
						placeholder="如：20多岁、中年、年过半百"
						className="config-input"
					/>
				</div>
				<div className="form-field">
					<label>身份职业</label>
					<input
						type="text"
						value={editForm.identity || ""}
						onChange={(e) => onFormChange({ ...editForm, identity: e.target.value })}
						placeholder="如：剑客、商人、书生、将军"
						className="config-input"
					/>
				</div>
				<div className="form-field">
					<label>社会地位</label>
					<input
						type="text"
						value={editForm.socialStatus || ""}
						onChange={(e) => onFormChange({ ...editForm, socialStatus: e.target.value })}
						placeholder="如：贵族、平民、江湖高手"
						className="config-input"
					/>
				</div>
				<div className="form-field">
					<label>核心性格</label>
					<input
						type="text"
						value={editForm.personality || ""}
						onChange={(e) => onFormChange({ ...editForm, personality: e.target.value })}
						placeholder="如：沉稳内敛、开朗活泼、心机深沉"
						className="config-input"
					/>
				</div>
				<div className="form-field">
					<label>外貌特征</label>
					<textarea
						value={editForm.appearance || ""}
						onChange={(e) => onFormChange({ ...editForm, appearance: e.target.value })}
						placeholder="身高、体型、面容、穿着风格等"
						className="config-input"
						style={{ minHeight: "40px" }}
					/>
				</div>
				<div className="form-field">
					<label>出身背景</label>
					<textarea
						value={editForm.background || ""}
						onChange={(e) => onFormChange({ ...editForm, background: e.target.value })}
						placeholder="家庭背景、成长环境等"
						className="config-input"
						style={{ minHeight: "40px" }}
					/>
				</div>
				<div className="form-field">
					<label>角色弧光</label>
					<textarea
						value={editForm.characterArc || ""}
						onChange={(e) => onFormChange({ ...editForm, characterArc: e.target.value })}
						placeholder="角色成长变化、内心转变、价值观演变等"
						className="config-input"
						style={{ minHeight: "40px" }}
					/>
				</div>

				<div className="form-field">
					<label>备注</label>
					<textarea
						value={editForm.notes || ""}
						onChange={(e) => onFormChange({ ...editForm, notes: e.target.value })}
						className="config-input"
					/>
				</div>
				<div className="form-field">
					<label>小说大事记</label>
					<div className="event-edit-form-btn">
						<button
							type="button"
							className="btn"
							onClick={onShowEventModal}
						>
							<Icons.list size={14} />
							<span>管理小说大事记</span>
						</button>
						<span className="event-edit-form-hint">
							在全局大事记中关联此角色，即可在角色卡片中查看
						</span>
					</div>
				</div>
				<div className="flex gap-2 pt-2">
					<button
						className="btn btn-primary"
						onClick={onEnhanceCharacter}
						disabled={isEnhancingCharacter || !editForm.name}
					>
						<Icons.sparkle size={14} />
						<span>{isEnhancingCharacter ? "完善中..." : "AI完善"}</span>
					</button>
					<button
						className="btn"
						onClick={onSave}
					>
						<Icons.saveIcon size={14} />
						<span>保存</span>
					</button>
					<button
						className="btn"
						onClick={onCancel}
					>
						<Icons.x size={14} />
						<span>取消</span>
					</button>
				</div>
			</div>
		</div>
	);
}