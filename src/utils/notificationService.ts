import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
	type Options,
} from '@tauri-apps/plugin-notification';

let notificationPermissionGranted = false;

export async function initNotificationService(): Promise<boolean> {
	try {
		notificationPermissionGranted = await isPermissionGranted();
		if (!notificationPermissionGranted) {
			const permission = await requestPermission();
			notificationPermissionGranted = permission === 'granted';
		}
		return notificationPermissionGranted;
	} catch (e) {
		console.error('[NotificationService] Failed to init:', e);
		return false;
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

	const notification: Options = {
		title: '校对进度',
		body: `${chapterTitle}\n已处理 ${processed}/${totalErrors} 个问题\n剩余 ${remainingErrors} 个问题\n进度 ${percent}%`,
	};

	try {
		await sendNotification(notification);
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

	const notification: Options = {
		title: '✅ 校对完成',
		body: `${chapterTitle}\n共发现 ${totalErrors} 个问题\n已处理 ${processedCount} 个`,
	};

	try {
		await sendNotification(notification);
	} catch (e) {
		console.error('[NotificationService] Failed to send notification:', e);
	}
}
