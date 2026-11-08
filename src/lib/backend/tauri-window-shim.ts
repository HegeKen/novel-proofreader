// ============================================================
// Web 模式下的窗口 API 适配：窗口标题等操作在浏览器中无效，安全降级
// 仅在 Web 构建时通过 Vite alias 替换 @tauri-apps/api/window
// ==========================================================

interface WindowShim {
	setTitle: (title: string) => Promise<void>;
	show: () => Promise<void>;
	hide: () => Promise<void>;
	close: () => Promise<void>;
	minimize: () => Promise<void>;
	maximize: () => Promise<void>;
}

const windowShim: WindowShim = {
	setTitle: async (title: string) => {
		if (typeof document !== "undefined") document.title = title;
	},
	show: async () => {},
	hide: async () => {},
	close: async () => {},
	minimize: async () => {},
	maximize: async () => {},
};

export function getCurrentWindow(): WindowShim {
	return windowShim;
}

export function getCurrentWebviewWindow(): WindowShim {
	return windowShim;
}
