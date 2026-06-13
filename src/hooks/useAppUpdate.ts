import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';

interface UpdateInfo {
	version: string;
	notes: string;
	pubDate: string;
}

export function useAppUpdate() {
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
	const [checking, setChecking] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState(0);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const updateRef = useRef<any>(null);
	const checkingRef = useRef(false);
	const downloadingRef = useRef(false);

	const checkForUpdate = useCallback(async () => {
		if (checkingRef.current) return;
		checkingRef.current = true;
		setChecking(true);

		try {
			const { check } = await import('@tauri-apps/plugin-updater');
			const update = await check();
			if (update) {
				updateRef.current = update;
				setUpdateInfo({
					version: update.version,
					notes: update.body ?? '',
					pubDate: update.date ?? '',
				});
				logger.info('Updater', `New version available: ${update.version}`);
			} else {
				logger.info('Updater', 'App is up to date');
			}
		} catch (err) {
			logger.warn('Updater', 'Failed to check for updates:', err);
		} finally {
			checkingRef.current = false;
			setChecking(false);
		}
	}, []);

	const installUpdate = useCallback(async () => {
		if (downloadingRef.current) return;
		const update = updateRef.current;
		if (!update) return;

		downloadingRef.current = true;
		setDownloading(true);

		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await update.downloadAndInstall?.((progress: any) => {
				const evt = progress as { event: string; data: { contentLength?: number; chunkLength?: number } };
				if (evt.event === 'Started' && evt.data.contentLength) {
					setDownloadProgress(0);
				} else if (evt.event === 'Progress') {
					setDownloadProgress(prev => prev + (evt.data.chunkLength ?? 0));
				} else if (evt.event === 'Finished') {
					setDownloadProgress(100);
				}
			});
		} catch (err) {
			logger.errorGeneric('Updater', 'Failed to install update:', err);
		} finally {
			downloadingRef.current = false;
			setDownloading(false);
		}
	}, []);

	useEffect(() => {
		const initialCheck = async () => {
			try {
				const { check } = await import('@tauri-apps/plugin-updater');
				const update = await check();
				if (update) {
					updateRef.current = update;
					setUpdateInfo({
						version: update.version,
						notes: update.body ?? '',
						pubDate: update.date ?? '',
					});
					logger.info('Updater', `New version available: ${update.version}`);
				} else {
					logger.info('Updater', 'App is up to date');
				}
			} catch (err) {
				logger.warn('Updater', 'Failed to check for updates:', err);
			}
		};
		initialCheck();
	}, []);

	return {
		updateInfo,
		checking,
		downloading,
		downloadProgress,
		checkForUpdate,
		installUpdate,
	};
}
