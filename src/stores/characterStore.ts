import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CharacterInfo, CharacterRelationship, NovelWorldbuilding, NovelEvent } from "../types";
import { generateId, filterRecordByKeys } from "../utils/id";


export interface CharacterState {
	novelCharacters: Record<string, CharacterInfo[]>;
	characterRelationships: Record<string, CharacterRelationship[]>;
	nodePositions: Record<string, Record<string, { x: number; y: number }>>;
	ignoredCharacterNames: Record<string, string[]>;
	worldbuilding: Record<string, NovelWorldbuilding>;
	novelEvents: Record<string, NovelEvent[]>; // 每个小说的大事记列表

	addCharacter: (novelId: string, character: Omit<CharacterInfo, "id">) => string;
	updateCharacter: (novelId: string, characterId: string, character: Partial<Omit<CharacterInfo, "id">>) => void;
	removeCharacter: (novelId: string, characterId: string) => void;
	getCharacters: (novelId: string) => CharacterInfo[];
	setCharactersForNovel: (novelId: string, characters: CharacterInfo[]) => void;

	addRelationship: (novelId: string, relationship: Omit<CharacterRelationship, "id" | "novelId">) => void;
	updateRelationship: (novelId: string, relationshipId: string, relationship: Partial<Omit<CharacterRelationship, "id" | "novelId">>) => void;
	removeRelationship: (novelId: string, relationshipId: string) => void;
	getRelationshipsForNovel: (novelId: string) => CharacterRelationship[];
	setRelationshipsForNovel: (novelId: string, relationships: CharacterRelationship[]) => void;

	setNodePositions: (novelId: string, positions: Record<string, { x: number; y: number }>) => void;

	addIgnoredCharacterName: (novelId: string, name: string) => void;
	getIgnoredCharacterNames: (novelId: string) => string[];
	setIgnoredCharacterNames: (novelId: string, names: string[]) => void;

	getWorldbuilding: (novelId: string) => NovelWorldbuilding | null;
	setWorldbuilding: (novelId: string, wb: NovelWorldbuilding) => void;

	// 小说大事记
	getEvents: (novelId: string) => NovelEvent[];
	addEvent: (novelId: string, event: Omit<NovelEvent, "id">) => void;
	updateEvent: (novelId: string, eventId: string, updates: Partial<Omit<NovelEvent, "id">>) => void;
	removeEvent: (novelId: string, eventId: string) => void;
	setEvents: (novelId: string, events: NovelEvent[]) => void;

	clearNovelData: (novelId: string) => void;
	rebuildStatistics: (validNovelIds: string[]) => void;
}

function syncNicknamesToCharacters(
	characters: CharacterInfo[],
	nicknames: string[],
	targetId: string | undefined,
): CharacterInfo[] {
	if (!nicknames.length || !targetId) return characters;
	return characters.map(char => {
		if (char.id !== targetId) return char;
		const existing = char.relationTerms ?? [];
		return { ...char, relationTerms: [...new Set([...existing, ...nicknames])] };
	});
}

export const useCharacterStore = create<CharacterState>()(
	persist(
		(set, get) => ({
			novelCharacters: {},
			characterRelationships: {},
			nodePositions: {},
			ignoredCharacterNames: {},
			worldbuilding: {},
			novelEvents: {},

			addCharacter: (novelId, character) => {
				const newCharacter = { ...character, id: generateId("char") };
				set((state) => {
					const updatedCharacters = [...(state.novelCharacters[novelId] ?? []), newCharacter];
					return { novelCharacters: { ...state.novelCharacters, [novelId]: updatedCharacters } };
				});
				return newCharacter.id;
			},

			updateCharacter: (novelId, characterId, character) =>
				set((state) => ({
					novelCharacters: {
						...state.novelCharacters,
						[novelId]: (state.novelCharacters[novelId] ?? []).map((ch) =>
							ch.id === characterId ? { ...ch, ...character } : ch
						),
					},
				})),

			removeCharacter: (novelId, characterId) =>
				set((state) => ({
					novelCharacters: {
						...state.novelCharacters,
						[novelId]: (state.novelCharacters[novelId] ?? []).filter((ch) => ch.id !== characterId),
					},
					// 同步清理该角色相关的所有关系，避免产生悬空关系
					characterRelationships: {
						...state.characterRelationships,
						[novelId]: (state.characterRelationships[novelId] ?? []).filter(
							(r) => r.sourceId !== characterId && r.targetId !== characterId
						),
					},
				})),

			getCharacters: (novelId) => get().novelCharacters[novelId] ?? [],

			setCharactersForNovel: (novelId, characters) =>
				set((state) => ({
					novelCharacters: { ...state.novelCharacters, [novelId]: characters },
				})),

			addRelationship: (novelId, relationship) => {
				const newRelationship: CharacterRelationship = {
					...relationship,
					id: generateId("rel"),
					novelId,
				};
				set((state) => {
					let updatedCharacters = state.novelCharacters[novelId] ?? [];
					updatedCharacters = syncNicknamesToCharacters(updatedCharacters, relationship.sourceNickname ?? [], relationship.targetId);
					updatedCharacters = syncNicknamesToCharacters(updatedCharacters, relationship.targetNickname ?? [], relationship.sourceId);
					return {
						characterRelationships: {
							...state.characterRelationships,
							[novelId]: [...(state.characterRelationships[novelId] ?? []), newRelationship],
						},
						novelCharacters: { ...state.novelCharacters, [novelId]: updatedCharacters },
					};
				});
			},

			updateRelationship: (novelId, relationshipId, relationship) =>
				set((state) => {
					let updatedCharacters = state.novelCharacters[novelId] ?? [];
					updatedCharacters = syncNicknamesToCharacters(updatedCharacters, relationship.sourceNickname ?? [], relationship.targetId);
					updatedCharacters = syncNicknamesToCharacters(updatedCharacters, relationship.targetNickname ?? [], relationship.sourceId);
					return {
						characterRelationships: {
							...state.characterRelationships,
							[novelId]: (state.characterRelationships[novelId] ?? []).map((r) =>
								r.id === relationshipId ? { ...r, ...relationship } : r
							),
						},
						novelCharacters: { ...state.novelCharacters, [novelId]: updatedCharacters },
					};
				}),

			removeRelationship: (novelId, relationshipId) =>
				set((state) => ({
					characterRelationships: {
						...state.characterRelationships,
						[novelId]: (state.characterRelationships[novelId] ?? []).filter((r) => r.id !== relationshipId),
					},
				})),

			getRelationshipsForNovel: (novelId) => get().characterRelationships[novelId] ?? [],

			setRelationshipsForNovel: (novelId, relationships) =>
				set((state) => ({
					characterRelationships: { ...state.characterRelationships, [novelId]: relationships },
				})),

			setNodePositions: (novelId, positions) =>
				set((state) => ({
					nodePositions: { ...state.nodePositions, [novelId]: positions },
				})),

			addIgnoredCharacterName: (novelId, name) =>
				set((state) => {
					const currentNames = state.ignoredCharacterNames[novelId] ?? [];
					if (currentNames.includes(name)) return state;
					return {
						ignoredCharacterNames: {
							...state.ignoredCharacterNames,
							[novelId]: [...currentNames, name],
						},
					};
				}),

			getIgnoredCharacterNames: (novelId) => get().ignoredCharacterNames[novelId] ?? [],

			setIgnoredCharacterNames: (novelId, names) =>
				set((state) => ({
					ignoredCharacterNames: { ...state.ignoredCharacterNames, [novelId]: names },
				})),

			getWorldbuilding: (novelId) => get().worldbuilding[novelId] ?? null,

			setWorldbuilding: (novelId, wb) =>
				set((state) => ({
					worldbuilding: { ...state.worldbuilding, [novelId]: wb },
				})),

			// --- 小说大事记 ---
			getEvents: (novelId) => get().novelEvents[novelId] ?? [],

			addEvent: (novelId, event) => {
				const newEvent: NovelEvent = {
					...event,
					id: generateId("evt"),
				};
				set((state) => {
					const current = state.novelEvents[novelId] ?? [];
					return {
						novelEvents: {
							...state.novelEvents,
							[novelId]: [...current, newEvent].sort((a, b) => a.timeOrder - b.timeOrder),
						},
					};
				});
			},

			updateEvent: (novelId, eventId, updates) =>
				set((state) => {
					const current = state.novelEvents[novelId] ?? [];
					return {
						novelEvents: {
							...state.novelEvents,
							[novelId]: current
								.map((evt) => (evt.id === eventId ? { ...evt, ...updates } : evt))
								.sort((a, b) => a.timeOrder - b.timeOrder),
						},
					};
				}),

			removeEvent: (novelId, eventId) =>
				set((state) => {
					const current = state.novelEvents[novelId] ?? [];
					return {
						novelEvents: {
							...state.novelEvents,
							[novelId]: current.filter((evt) => evt.id !== eventId),
						},
					};
				}),

			setEvents: (novelId, events) =>
				set((state) => ({
					novelEvents: {
						...state.novelEvents,
						[novelId]: [...events].sort((a, b) => a.timeOrder - b.timeOrder),
					},
				})),

			clearNovelData: (novelId) => {
			const state = get();
			const updatedWorldbuilding = { ...state.worldbuilding };
			delete updatedWorldbuilding[novelId];
			set({
				novelCharacters: {
					...state.novelCharacters,
					[novelId]: [],
				},
				characterRelationships: {
					...state.characterRelationships,
					[novelId]: [],
				},
				nodePositions: {
					...state.nodePositions,
					[novelId]: {},
				},
				ignoredCharacterNames: {
					...state.ignoredCharacterNames,
					[novelId]: [],
				},
				worldbuilding: updatedWorldbuilding,
				novelEvents: {
					...state.novelEvents,
					[novelId]: [],
				},
			});
		},

		rebuildStatistics: (validNovelIds) => {
			set((state) => ({
				novelCharacters: filterRecordByKeys(state.novelCharacters, validNovelIds),
				characterRelationships: filterRecordByKeys(state.characterRelationships, validNovelIds),
				nodePositions: filterRecordByKeys(state.nodePositions, validNovelIds),
				ignoredCharacterNames: filterRecordByKeys(state.ignoredCharacterNames, validNovelIds),
				worldbuilding: filterRecordByKeys(state.worldbuilding, validNovelIds),
				novelEvents: filterRecordByKeys(state.novelEvents, validNovelIds),
			}));
		},
	}),
		{
			name: "novel-proofreader-characters",
			partialize: (state) => ({
				novelCharacters: state.novelCharacters,
				characterRelationships: state.characterRelationships,
				nodePositions: state.nodePositions,
				ignoredCharacterNames: state.ignoredCharacterNames,
				worldbuilding: state.worldbuilding,
				novelEvents: state.novelEvents,
			}),
		},
	),
);
