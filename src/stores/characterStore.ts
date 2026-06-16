import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CharacterInfo, CharacterRelationship, NovelWorldbuilding } from "../types";


export interface CharacterState {
	novelCharacters: Record<string, CharacterInfo[]>;
	characterRelationships: Record<string, CharacterRelationship[]>;
	nodePositions: Record<string, Record<string, { x: number; y: number }>>;
	ignoredCharacterNames: Record<string, string[]>;
	worldbuilding: Record<string, NovelWorldbuilding>;

	addCharacter: (novelId: string, character: Omit<CharacterInfo, "id">) => void;
	updateCharacter: (novelId: string, characterId: string, character: Partial<Omit<CharacterInfo, "id">>) => void;
	removeCharacter: (novelId: string, characterId: string) => void;
	getCharacters: (novelId: string) => CharacterInfo[];
	setCharactersForNovel: (novelId: string, characters: CharacterInfo[]) => void;

	addRelationship: (novelId: string, relationship: Omit<CharacterRelationship, "id" | "novelId">) => void;
	updateRelationship: (novelId: string, relationshipId: string, relationship: Partial<Omit<CharacterRelationship, "id" | "novelId">>) => void;
	removeRelationship: (novelId: string, relationshipId: string) => void;
	removeRelationshipsForCharacter: (novelId: string, characterId: string) => void;
	getRelationshipsForNovel: (novelId: string) => CharacterRelationship[];
	setRelationshipsForNovel: (novelId: string, relationships: CharacterRelationship[]) => void;

	setNodePositions: (novelId: string, positions: Record<string, { x: number; y: number }>) => void;
	clearNodePositions: (novelId: string) => void;

	addIgnoredCharacterName: (novelId: string, name: string) => void;
	getIgnoredCharacterNames: (novelId: string) => string[];
	setIgnoredCharacterNames: (novelId: string, names: string[]) => void;

	getWorldbuilding: (novelId: string) => NovelWorldbuilding | null;
	setWorldbuilding: (novelId: string, wb: NovelWorldbuilding) => void;
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

			addCharacter: (novelId, character) => {
				const newCharacter = { ...character, id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
				set((state) => {
					const updatedCharacters = [...(state.novelCharacters[novelId] ?? []), newCharacter];
					return { novelCharacters: { ...state.novelCharacters, [novelId]: updatedCharacters } };
				});
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
				})),

			getCharacters: (novelId) => get().novelCharacters[novelId] ?? [],

			setCharactersForNovel: (novelId, characters) =>
				set((state) => ({
					novelCharacters: { ...state.novelCharacters, [novelId]: characters },
				})),

			addRelationship: (novelId, relationship) => {
				const newRelationship: CharacterRelationship = {
					...relationship,
					id: `rel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

			removeRelationshipsForCharacter: (novelId, characterId) =>
				set((state) => ({
					characterRelationships: {
						...state.characterRelationships,
						[novelId]: (state.characterRelationships[novelId] ?? []).filter(
							(r) => r.sourceId !== characterId && r.targetId !== characterId
						),
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

			clearNodePositions: (novelId) =>
				set((state) => {
					const updated = { ...state.nodePositions };
					delete updated[novelId];
					return { nodePositions: updated };
				}),

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
		}),
		{
			name: "novel-proofreader-characters",
			partialize: (state) => ({
				novelCharacters: state.novelCharacters,
				characterRelationships: state.characterRelationships,
				nodePositions: state.nodePositions,
				ignoredCharacterNames: state.ignoredCharacterNames,
				worldbuilding: state.worldbuilding,
			}),
		},
	),
);
