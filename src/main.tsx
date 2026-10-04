import React from "react";
import ReactDOM from "react-dom/client";
import "./App.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { preloadSecureStorage } from "./utils/secureStorage";

// 渲染前预热安全存储缓存：store 模块顶层（如 configStore 的 tts-api-key）
// 会同步调用 secureStorageGet，必须等加密数据解密入缓存后再加载 App，
// 否则首次读取返回 null 导致 API Key 瞬态丢失
async function bootstrap() {
	try {
		await preloadSecureStorage();
	} catch {
		// 预热失败不阻塞启动，各 store 的 onRehydrateStorage 会再次尝试
	}
	// 动态导入 App，确保其依赖的 store 模块在缓存预热后才执行顶层读取
	const { default: App } = await import("./App");
	ReactDOM.createRoot(document.getElementById("root")!).render(
		<React.StrictMode>
			<ErrorBoundary>
				<App />
			</ErrorBoundary>
		</React.StrictMode>,
	);
}

bootstrap();
