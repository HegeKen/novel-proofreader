import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
	type Options,
} from '@tauri-apps/plugin-notification';

let notificationPermissionGranted = false;
let tauriAvailable = true;

export async function initNotificationService(): Promise<boolean> {
	try {
		// 检查是否在 Tauri 环境中运行
		if (typeof window !== 'undefined' && !(window as any).__TAURI__) {
			tauriAvailable = false;
			console.log('[NotificationService] Tauri not available, using browser notifications');
			// 尝试使用浏览器原生通知 API
			if ('Notification' in window) {
				const permission = await Notification.requestPermission();
				notificationPermissionGranted = permission === 'granted';
			}
			return notificationPermissionGranted;
		}
		
		notificationPermissionGranted = await isPermissionGranted();
		if (!notificationPermissionGranted) {
			const permission = await requestPermission();
			notificationPermissionGranted = permission === 'granted';
		}
		return notificationPermissionGranted;
	} catch (e) {
		console.warn('[NotificationService] Failed to init (fallback to browser):', e);
		tauriAvailable = false;
		// 降级到浏览器原生通知
		if ('Notification' in window) {
			const permission = await Notification.requestPermission();
			notificationPermissionGranted = permission === 'granted';
		}
		return notificationPermissionGranted;
	}
}

export interface ProofreadProgress {
	chapterTitle: string;
	totalErrors: number;
	remainingErrors: number;
	processedCount: number;
}

export async function updateProofreadProgress(
	progress: ProofreadProgress
): Promise<void> {
	if (!notificationPermissionGranted) {
		const granted = await initNotificationService();
		if (!granted) return;
	}

	const { chapterTitle, totalErrors, remainingErrors } = progress;
	const processed = totalErrors - remainingErrors;
	const percent = totalErrors > 0 ? Math.round((processed / totalErrors) * 100) : 0;

	const title = '校对进度';
	const body = `${chapterTitle}\n已处理 ${processed}/${totalErrors} 个问题\n剩余 ${remainingErrors} 个问题\n进度 ${percent}%`;

	try {
		if (tauriAvailable) {
			const notification: Options = { title, body };
			await sendNotification(notification);
		} else if ('Notification' in window) {
			new Notification(title, { body });
		}
	} catch (e) {
		console.error('[NotificationService] Failed to send notification:', e);
	}
}

export async function sendProofreadCompleteNotification(
	chapterTitle: string,
	totalErrors: number,
	processedCount: number
): Promise<void> {
	if (!notificationPermissionGranted) {
		const granted = await initNotificationService();
		if (!granted) return;
	}

	const title = '✅ 校对完成';
	const body = `${chapterTitle}\n共发现 ${totalErrors} 个问题\n已处理 ${processedCount} 个`;

	try {
		if (tauriAvailable) {
			const notification: Options = { title, body };
			await sendNotification(notification);
		} else if ('Notification' in window) {
			new Notification(title, { body });
		}
	} catch (e) {
		console.error('[NotificationService] Failed to send notification:', e);
	}
}
