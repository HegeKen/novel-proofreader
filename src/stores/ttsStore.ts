// ============================================================
// TTS 朗读状态 — 播放标志与高亮段落（跨 ProofreadPanel/ReaderPanel 共享）
// ============================================================
import { create } from "zustand";

interface TtsState {
	ttsPlaying: boolean;
	ttsHighlightedPara: number;
	setTtsPlaying: (playing: boolean) => void;
	setTtsHighlightedPara: (paraIndex: number) => void;
}

export const useTtsStore = create<TtsState>((set) => ({
	ttsPlaying: false,
	ttsHighlightedPara: -1,
	setTtsPlaying: (playing) => set({ ttsPlaying: playing }),
	setTtsHighlightedPara: (paraIndex) => set({ ttsHighlightedPara: paraIndex }),
}));
