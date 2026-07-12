import { useState, useCallback } from "react";
import type { CharacterRelationship, RelationType, CharacterInfo } from "../../types";
import { Icons } from "../Icons";
import { Select } from "../Select";
import { useAppMetaStore } from "../../stores/appMetaStore";

interface RelationshipManagerProps {
	relationships: CharacterRelationship[];
	characters: CharacterInfo[];
	novelId: string;
	onAddRelationship: (novelId: string, relation: Omit<CharacterRelationship, "id">) => void;
	onRemoveRelationship: (novelId: string, relationId: string) => void;
	onUpdateRelationship: (novelId: string, relationId: string, updates: Partial<CharacterRelationship>) => void;
}

const RELATION_TYPE_OPTIONS: Array<{ value: RelationType; label: string }> = [
	{ value: "couple", label: "夫妻" },
	{ value: "lover", label: "恋人" },
	{ value: "ex-lover", label: "前任" },
	{ value: "father-son", label: "父子" },
	{ value: "father-daughter", label: "父女" },
	{ value: "mother-son", label: "母子" },
	{ value: "mother-daughter", label: "母女" },
	{ value: "brother", label: "兄弟" },
	{ value: "sister", label: "姐妹" },
	{ value: "brother-sister", label: "兄妹" },
	{ value: "sister-brother", label: "姐弟" },
	{ value: "friend", label: "朋友" },
	{ value: "bestie", label: "闺蜜" },
	{ value: "rival", label: "竞争对手" },
	{ value: "arch-enemy", label: "宿敌" },
	{ value: "enemy", label: "仇人" },
	{ value: "master-disciple", label: "师徒" },
	{ value: "teacher-student", label: "师生" },
	{ value: "colleague", label: "同事" },
	{ value: "other", label: "其他" },
];

export function RelationshipManager({
	relationships,
	characters,
	novelId,
	onAddRelationship,
	onRemoveRelationship,
	onUpdateRelationship,
}: RelationshipManagerProps) {
	const [showForm, setShowForm] = useState(false);
	const [editingRelation, setEditingRelation] = useState<CharacterRelationship | null>(null);
	const [relationForm, setRelationForm] = useState({
		sourceId: "",
		targetId: "",
		relationType: [] as RelationType[],
		customRelationType: "",
		sourceNickname: [] as string[],
		targetNickname: [] as string[],
		newSourceNickname: "",
		newTargetNickname: "",
	});

	const getCharacterById = useCallback(
		(id: string) => characters.find((c) => c.id === id),
		[characters]
	);

	const handleAddSourceNickname = () => {
		if (relationForm.newSourceNickname.trim()) {
			setRelationForm((prev) => ({
				...prev,
				sourceNickname: [...prev.sourceNickname, prev.newSourceNickname.trim()],
				newSourceNickname: "",
			}));
		}
	};

	const handleRemoveSourceNickname = (index: number) => {
		setRelationForm((prev) => ({
			...prev,
			sourceNickname: prev.sourceNickname.filter((_, i) => i !== index),
		}));
	};

	const handleAddTargetNickname = () => {
		if (relationForm.newTargetNickname.trim()) {
			setRelationForm((prev) => ({
				...prev,
				targetNickname: [...prev.targetNickname, prev.newTargetNickname.trim()],
				newTargetNickname: "",
			}));
		}
	};

	const handleRemoveTargetNickname = (index: number) => {
		setRelationForm((prev) => ({
			...prev,
			targetNickname: prev.targetNickname.filter((_, i) => i !== index),
		}));
	};

	const handleSubmit = () => {
		if (!relationForm.sourceId || !relationForm.targetId) {
			useAppMetaStore.getState().showToast("请选择源角色和目标角色", "warning");
			return;
		}
		if (relationForm.sourceId === relationForm.targetId) {
			useAppMetaStore.getState().showToast("源角色和目标角色不能相同", "warning");
			return;
		}

		if (editingRelation) {
			onUpdateRelationship(novelId, editingRelation.id, {
				sourceId: relationForm.sourceId,
				targetId: relationForm.targetId,
				relationType: relationForm.relationType,
				customRelationType: relationForm.customRelationType,
				sourceNickname: relationForm.sourceNickname,
				targetNickname: relationForm.targetNickname,
			});
		} else {
			onAddRelationship(novelId, {
				novelId,
				sourceId: relationForm.sourceId,
				targetId: relationForm.targetId,
				relationType: relationForm.relationType,
				customRelationType: relationForm.customRelationType,
				sourceNickname: relationForm.sourceNickname,
				targetNickname: relationForm.targetNickname,
			});
		}

		setShowForm(false);
		setEditingRelation(null);
		setRelationForm({
			sourceId: "",
			targetId: "",
			relationType: [],
			customRelationType: "",
			sourceNickname: [],
			targetNickname: [],
			newSourceNickname: "",
			newTargetNickname: "",
		});
	};

	const handleEdit = (relation: CharacterRelationship) => {
		setEditingRelation(relation);
		setRelationForm({
			sourceId: relation.sourceId,
			targetId: relation.targetId,
			relationType: relation.relationType || [],
			customRelationType: relation.customRelationType || "",
			sourceNickname: relation.sourceNickname || [],
			targetNickname: relation.targetNickname || [],
			newSourceNickname: "",
			newTargetNickname: "",
		});
		setShowForm(true);
	};

	const handleDelete = (relationId: string) => {
		onRemoveRelationship(novelId, relationId);
	};

	const getRelationLabel = (type: RelationType) => {
		const option = RELATION_TYPE_OPTIONS.find(opt => opt.value === type);
		return option ? option.label : type;
	};

	return (
		<div className="relationship-manager">
			<div className="manager-header">
				<h3>关系管理</h3>
				<button className="btn btn-sm" onClick={() => setShowForm(true)}>
					<Icons.plus size={14} />
					添加关系
				</button>
			</div>
			{showForm && (
				<div className="relationship-form">
					<div className="form-header">
						<h4>{editingRelation ? "编辑关系" : "添加关系"}</h4>
						<button className="close-btn" onClick={() => {
							setShowForm(false);
							setEditingRelation(null);
						}}>
							<Icons.x size={16} />
						</button>
					</div>
					<div className="form-body">
						<div className="form-row">
							<div className="form-field">
								<label>源角色</label>
								<select
									value={relationForm.sourceId}
									onChange={(e) => setRelationForm({ ...relationForm, sourceId: e.target.value })}
									className="form-select"
								>
									<option value="">选择角色...</option>
									{characters.map((char) => (
										<option key={char.id} value={char.id}>
											{char.name}
										</option>
									))}
								</select>
							</div>
							<div className="form-field">
								<label>目标角色</label>
								<select
									value={relationForm.targetId}
									onChange={(e) => setRelationForm({ ...relationForm, targetId: e.target.value })}
									className="form-select"
								>
									<option value="">选择角色...</option>
									{characters.map((char) => (
										<option key={char.id} value={char.id}>
											{char.name}
										</option>
									))}
								</select>
							</div>
						</div>
						<div className="form-field">
							<label>关系类型</label>
							<Select
								value={relationForm.relationType[0] || ""}
								onChange={(v) => setRelationForm({ ...relationForm, relationType: v ? [v as RelationType] : [] })}
								options={RELATION_TYPE_OPTIONS}
							/>
						</div>
						<div className="form-field">
							<label>源对目标的称呼</label>
							<div className="tags-input-row">
								<input
									type="text"
									className="form-input"
									value={relationForm.newSourceNickname}
									onChange={(e) => setRelationForm({ ...relationForm, newSourceNickname: e.target.value })}
									onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSourceNickname())}
									placeholder="输入称呼后按回车添加"
								/>
								<button className="btn btn-sm" onClick={handleAddSourceNickname}>添加</button>
							</div>
							{(relationForm.sourceNickname || []).length > 0 && (
								<div className="tags-list">
									{(relationForm.sourceNickname || []).map((nickname, index) => (
										<span key={index} className="tag">
											{nickname}
											<button onClick={() => handleRemoveSourceNickname(index)} className="tag-remove">×</button>
										</span>
									))}
								</div>
							)}
						</div>
						<div className="form-field">
							<label>目标对源的称呼</label>
							<div className="tags-input-row">
								<input
									type="text"
									className="form-input"
									value={relationForm.newTargetNickname}
									onChange={(e) => setRelationForm({ ...relationForm, newTargetNickname: e.target.value })}
									onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTargetNickname())}
									placeholder="输入称呼后按回车添加"
								/>
								<button className="btn btn-sm" onClick={handleAddTargetNickname}>添加</button>
							</div>
							{(relationForm.targetNickname || []).length > 0 && (
								<div className="tags-list">
									{(relationForm.targetNickname || []).map((nickname, index) => (
										<span key={index} className="tag">
											{nickname}
											<button onClick={() => handleRemoveTargetNickname(index)} className="tag-remove">×</button>
										</span>
									))}
								</div>
							)}
						</div>
					</div>
					<div className="form-footer">
						<button className="btn" onClick={() => {
							setShowForm(false);
							setEditingRelation(null);
						}}>取消</button>
						<button className="btn btn-primary" onClick={handleSubmit}>
							{editingRelation ? "保存修改" : "添加关系"}
						</button>
					</div>
				</div>
			)}
			<div className="relationship-list">
				{relationships.length === 0 ? (
					<div className="empty-state">
							<Icons.user size={24} className="text-neutral-500" />
							<p>暂无角色关系</p>
							<button className="btn" onClick={() => setShowForm(true)}>添加关系</button>
						</div>
				) : (
					<div className="relation-items">
						{relationships.map((relation) => {
							const sourceChar = getCharacterById(relation.sourceId);
							const targetChar = getCharacterById(relation.targetId);
							return (
								<div key={relation.id} className="relation-item">
									<div className="relation-info">
									<span className="relation-source">{sourceChar?.name || "未知"}</span>
									<Icons.chevronRight size={14} className="relation-arrow" />
									<span className="relation-type">{(relation.relationType || []).map(t => getRelationLabel(t)).join(", ")}</span>
									<Icons.chevronRight size={14} className="relation-arrow" />
									<span className="relation-target">{targetChar?.name || "未知"}</span>
								</div>
									<div className="relation-nicknames">
										{relation.sourceNickname && relation.sourceNickname.length > 0 && (
											<span className="nickname">{sourceChar?.name}称呼: {relation.sourceNickname.join(", ")}</span>
										)}
										{relation.targetNickname && relation.targetNickname.length > 0 && (
											<span className="nickname">{targetChar?.name}称呼: {relation.targetNickname.join(", ")}</span>
										)}
									</div>
									<div className="relation-actions">
										<button className="btn btn-sm" onClick={() => handleEdit(relation)}>
											<Icons.edit size={12} />
										</button>
										<button className="btn btn-sm btn-danger" onClick={() => handleDelete(relation.id)}>
											<Icons.trash2 size={12} />
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}