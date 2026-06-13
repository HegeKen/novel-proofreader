import { useNovelStore } from "../../stores/novelStore";
import { useCharacterStore } from "../../stores/characterStore";
import { Icons } from "../Icons";

export function DataManagementSection() {
	const novels = useNovelStore((s) => s.novels);
	const novelCharacters = useCharacterStore((s) => s.novelCharacters);
	const totalNovels = novels.length;
	const totalCharacters = Object.values(novelCharacters).reduce((acc, chars) => acc + chars.length, 0);

	return (
		<div className="config-section data-management-section">
			<div className="section-header">
				<div className="section-label"><Icons.settings size={16} />数据管理</div>
				<span className="section-hint">管理本地存储的小说和角色数据</span>
			</div>
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
					<button className="clear-cache-btn" onClick={() => {
						if (window.confirm("确定要清除所有数据吗？此操作不可恢复！")) {
							useNovelStore.getState().clearAllCache();
							window.location.reload();
						}
					}}>
						<Icons.trash2 size={14} />确认清除
					</button>
				</div>
			</div>
		</div>
	);
}
