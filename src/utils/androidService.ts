import { invoke } from '@tauri-apps/api/core';

export async function startTtsService(): Promise<void> {
	await invoke('start_tts_service');
}

export async function stopTtsService(): Promise<void> {
	await invoke('stop_tts_service');
}

export async function updateTtsNotification(title: string, isPlaying: boolean): Promise<void> {
	await invoke('update_tts_notification', { title, isPlaying });
}

export async function startProofreadService(): Promise<void> {
	await invoke('start_proofread_service');
}

export async function stopProofreadService(): Promise<void> {
	await invoke('stop_proofread_service');
}
