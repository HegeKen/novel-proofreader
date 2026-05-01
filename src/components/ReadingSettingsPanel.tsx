import { useCallback } from "react";
import { useAppStore } from "../stores/appStore";

const BG_COLORS: Record<string, { bg: string; text: string }> = {
	white: { bg: "#FFFFFF", text: "#333333" },
	cream: { bg: "#FDF6E3", text: "#5C4A32" },
	sepia: { bg: "#F4E4BC", text: "#5C4033" },
	mint: { bg: "#E8F5E9", text: "#2E4A3E" },
	sky: { bg: "#E3F2FD", text: "#1565C0" },
	lavender: { bg: "#F3E5F5", text: "#6A1B9A" },
	peach: { bg: "#FFEBEE", text: "#B71C1C" },
	sage: { bg: "#EFEBE9", text: "#4E342E" },
	slate: { bg: "#ECEFF1", text: "#37474F" },
	dark: { bg: "#2C2C2C", text: "#E0E0E0" },
};

interface Props {
	onClose: () => void;
}

export function ReadingSettingsPanel({ onClose }: Props) {
	const lineSpacing = useAppStore((s) => s.lineSpacing);
	const setLineSpacing = useAppStore((s) => s.setLineSpacing);
	const paragraphSpacing = useAppStore((s) => s.paragraphSpacing);
	const setParagraphSpacing = useAppStore((s) => s.setParagraphSpacing);
	const readingBackground = useAppStore((s) => s.readingBackground);
	const setReadingBackground = useAppStore((s) => s.setReadingBackground);
	const customTextColor = useAppStore((s) => s.customTextColor);
	const customBgColor = useAppStore((s) => s.customBgColor);
	const setCustomColors = useAppStore((s) => s.setCustomColors);
	const bgImageUrl = useAppStore((s) => s.bgImageUrl);
	const setBgImageUrl = useAppStore((s) => s.setBgImageUrl);

	const handleBgChange = useCallback((bg: string) => {
		setReadingBackground(bg as "white" | "cream" | "sepia" | "mint" | "sky" | "lavender" | "peach" | "sage" | "slate" | "dark");
	}, [setReadingBackground]);

	const handleColorChange = useCallback((textColor: string, bgColor: string) => {
		setCustomColors(textColor, bgColor);
		setReadingBackground("custom");
	}, [setCustomColors, setReadingBackground]);

	const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			const url = ev.target?.result as string;
			setBgImageUrl(url);
			setReadingBackground("image");
		};
		reader.readAsDataURL(file);
	}, [setBgImageUrl, setReadingBackground]);

	const handleRemoveImage = useCallback(() => {
		setBgImageUrl("");
		setReadingBackground("cream");
	}, [setBgImageUrl, setReadingBackground]);

	return (
		<div className="reading-settings-panel" onClick={(e) => e.stopPropagation()}>
			<div className="settings-title">阅读设置 <button className="settings-close" onClick={onClose}>✕</button></div>

			<div className="setting-row">
				<span className="setting-label">行间距</span>
				<input type="range" min="1.0" max="4.0" step="0.1" value={lineSpacing} onChange={(e) => setLineSpacing(parseFloat(e.target.value))} />
				<span className="setting-value">{lineSpacing.toFixed(1)}x</span>
			</div>

			<div className="setting-row">
				<span className="setting-label">段间距</span>
				<input type="range" min="0" max="80" step="2" value={paragraphSpacing} onChange={(e) => setParagraphSpacing(parseInt(e.target.value))} />
				<span className="setting-value">{paragraphSpacing}px</span>
			</div>

			<div className="setting-row">
				<span className="setting-label">背景</span>
				<div className="bg-options">
					{Object.entries(BG_COLORS).map(([key, { bg }]) => (
						<button
							key={key}
							className={`bg-option${readingBackground === key ? " active" : ""}`}
							style={{ backgroundColor: bg }}
							onClick={() => handleBgChange(key as typeof BG_COLORS extends Record<infer K, { bg: string; text: string }> ? K : never)}
							title={key}
						/>
					))}
					{readingBackground === "custom" && (
						<button className="bg-option active custom-bg" style={{ background: `linear-gradient(135deg, ${customBgColor}, ${customTextColor})` }} title="自定义" />
					)}
				</div>
			</div>

			<div className="setting-row">
				<span className="setting-label">颜色</span>
				<div className="color-row">
					<label>文字<input type="color" value={customTextColor} onChange={(e) => handleColorChange(e.target.value, customBgColor)} /></label>
					<label>背景<input type="color" value={customBgColor} onChange={(e) => handleColorChange(customTextColor, e.target.value)} /></label>
				</div>
			</div>

			<div className="setting-row">
				<span className="setting-label">图片</span>
				<div className="image-row">
					<label className="upload-btn">📷<input type="file" accept="image/*" onChange={handleImageUpload} /></label>
					{readingBackground === "image" && bgImageUrl && <button className="remove-btn" onClick={handleRemoveImage}>✕</button>}
				</div>
			</div>
		</div>
	);
}
