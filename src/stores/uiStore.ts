import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReadingBackground, AppTab } from "../types";

export interface UIState {
	theme: "light" | "dark";
	fontSize: number;
	readingMode: boolean;
	lineSpacing: number;
	paragraphIndent: number;
	readingBackground: ReadingBackground;
	customTextColor: string;
	customBgColor: string;
	bgImageUrl: string;
	hideProofread: boolean;
	configModalOpen: boolean;
	showCharacterSettings: string | null;
	activeTab: AppTab;

	setTheme: (theme: "light" | "dark") => void;
	setFontSize: (size: number) => void;
	setReadingMode: (enabled: boolean) => void;
	setLineSpacing: (spacing: number) => void;
	setParagraphIndent: (indent: number) => void;
	setReadingBackground: (background: ReadingBackground) => void;
	setCustomColors: (textColor: string, bgColor: string) => void;
	setBgImageUrl: (url: string) => void;
	setHideProofread: (hide: boolean) => void;
	setConfigModalOpen: (open: boolean) => void;
	setShowCharacterSettings: (novelId: string | null) => void;
	setActiveTab: (tab: AppTab) => void;
}

export const useUIStore = create<UIState>()(
	persist(
		(set) => ({
			theme: "dark",
			fontSize: 16,
			readingMode: false,
			lineSpacing: 32,
			paragraphIndent: 2,
			readingBackground: "cream",
			customTextColor: "#333333",
			customBgColor: "#FDF6E3",
			bgImageUrl: "",
			hideProofread: false,
			configModalOpen: false,
			showCharacterSettings: null,
			activeTab: "proofread",

			setTheme: (theme) => set({ theme }),
			setFontSize: (size) => set({ fontSize: size }),
			setReadingMode: (enabled) => set({ readingMode: enabled }),
			setLineSpacing: (spacing) => set({ lineSpacing: spacing }),
			setParagraphIndent: (indent) => set({ paragraphIndent: indent }),
			setReadingBackground: (background) => set({ readingBackground: background }),
			setCustomColors: (textColor, bgColor) => set({ customTextColor: textColor, customBgColor: bgColor }),
			setBgImageUrl: (url) => set({ bgImageUrl: url }),
			setHideProofread: (hide) => set({ hideProofread: hide }),
			setConfigModalOpen: (open) => set({ configModalOpen: open }),
			setShowCharacterSettings: (novelId) => set({ showCharacterSettings: novelId }),
			setActiveTab: (tab) => set({ activeTab: tab }),
		}),
		{
			name: "novel-proofreader-ui",
			partialize: (state) => ({
				theme: state.theme,
				fontSize: state.fontSize,
				readingMode: state.readingMode,
				lineSpacing: state.lineSpacing,
				paragraphIndent: state.paragraphIndent,
				readingBackground: state.readingBackground,
				customTextColor: state.customTextColor,
				customBgColor: state.customBgColor,
				bgImageUrl: state.bgImageUrl,
				hideProofread: state.hideProofread,
			}),
		},
	),
);
