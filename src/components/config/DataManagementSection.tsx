import { useState } from "react";
import { useNovelStore } from "../../stores/novelStore";
import { useCharacterStore } from "../../stores/characterStore";
import { Icons } from "../Icons";
import { ConfirmModal } from "./ConfirmModal";

export function DataManagementSection() {
	const novels = useNovelStore((s) => s.novels);
	const removeNovel = useNovelStore((s) => s.removeNovel);
	const clearAllCache = useNovelStore((s) => s.clearAllCache);
	const novelCharacters = useCharacterStore((s) => s.novelCharacters);
	const clearNovelData = useCharacterStore((s) => s.clearNovelData);
	const totalNovels = novels.length;
	const totalCharacters = Object.values(novelCharacters).reduce((acc, chars) => acc + chars.length, 0);

	const [confirmModal, setConfirmModal] = useState<{
		show: boolean;
		title?: string;
		message: string;
		danger?: boolean;
		onConfirm: () => void;
	}>({ show: false, message: "", onConfirm: () => {} });

	const handleClearNovelData = (novelId: string, novelName: string) => {
		setConfirmModal({
			show: true,
			title: "清除数据",
			message: `确定要清除"${novelName}"的所有数据吗？\n\n这将删除该小说的角色、关系、世界观等所有关联数据。\n此操作不可恢复！`,
			danger: true,
			onConfirm: () => {
				clearNovelData(novelId);
				window.location.reload();
			},
		});
	};

	const handleDeleteNovel = (novelId: string, novelName: string) => {
		setConfirmModal({
			show: true,
			title: "删除小说",
			message: `确定要删除小说"${novelName}"吗？\n\n这将删除小说本身及其所有关联数据。\n此操作不可恢复！`,
			danger: true,
			onConfirm: () => {
				removeNovel(novelId);
				clearNovelData(novelId);
				window.location.reload();
			},
		});
	};

	const handleClearAll = () => {
		setConfirmModal({
			show: true,
			title: "清除所有数据",
			message: "确定要清除所有数据吗？\n\n此操作将清除所有小说、角色信息和编号，恢复为初始状态。\n此操作不可恢复！",
			danger: true,
			onConfirm: () => {
				clearAllCache();
				// 只清除小说和角色数据的持久化缓存（保留 AI 配置等其他设置）
				localStorage.removeItem("novel-proofreader-novels");
				localStorage.removeItem("novel-proofreader-characters");
				window.location.reload();
			},
		});
	};

	return (
		<div className="config-section data-management-section">
			<div className="data-stats">
				<div className="stat-item">
					<Icons.book size={20} />
					<div className="stat-info">
						<span className="stat-value">{totalNovels}</span>
						<span className="stat-label">小说数量</span>
					</div>
				</div>
				<div className="stat-divider"></div>
				<div className="stat-item">
					<Icons.user size={20} />
					<div className="stat-info">
						<span className="stat-value">{totalCharacters}</span>
						<span className="stat-label">角色数量</span>
					</div>
				</div>
			</div>

			{/* 小说列表 */}
			{novels.length > 0 && (
				<div className="novel-list-section">
					<div className="section-sub-label"><Icons.book size={14} />小说列表</div>
					<div className="novel-list">
						{novels.map(novel => {
							const characters = novelCharacters[novel.id] ?? [];
							return (
								<div key={novel.id} className="novel-item">
									<div className="novel-info">
										<div className="novel-name">{novel.name}</div>
										<div className="novel-meta">
											<span className="novel-chapters">{novel.chapters?.length ?? 0} 章</span>
											<span className="novel-divider">·</span>
											<span className="novel-characters">{characters.length} 角色</span>
										</div>
									</div>
									<div className="novel-actions">
										<button
											className="action-btn"
											onClick={() => handleClearNovelData(novel.id, novel.name)}
											title="清除数据"
										>
											<Icons.brushCleaning size={14} />
										</button>
										<button
											className="action-btn"
											onClick={() => handleDeleteNovel(novel.id, novel.name)}
											title="删除小说"
										>
											<Icons.trash2 size={14} />
										</button>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* 清除所有数据 */}
			<div className="data-action-card">
				<div className="action-header">
					<div className="action-icon warning"><Icons.alertTriangle size={20} /></div>
					<div className="action-title">
						<span className="action-label">清除所有数据</span>
						<span className="action-desc">此操作将清除所有小说、角色信息和编号，恢复为初始状态。</span>
					</div>
				</div>
				<div className="action-footer">
					<span className="action-warning">⚠️ 此操作不可撤销，请谨慎操作！</span>
					<button className="clear-cache-btn" onClick={handleClearAll}>
						<Icons.trash2 size={14} />确认清除
					</button>
				</div>
			</div>

			<ConfirmModal
				show={confirmModal.show}
				title={confirmModal.title}
				message={confirmModal.message}
				danger={confirmModal.danger}
				confirmText="确定"
				cancelText="取消"
				onConfirm={() => {
					confirmModal.onConfirm();
					setConfirmModal(prev => ({ ...prev, show: false }));
				}}
				onCancel={() => setConfirmModal(prev => ({ ...prev, show: false }))}
			/>
		</div>
	);
}