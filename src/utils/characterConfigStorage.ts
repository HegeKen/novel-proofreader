// ============================================================
// 角色配置文件存储 — 角色 JSON 配置的读写与模板创建
// ============================================================
import { exists, readTextFile, mkdir, writeTextFile, readDir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { logger } from './logger';
import { sanitizeNovelFilename } from './fileExport';

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI__' in window;
}

function getBaseDir(): BaseDirectory {
	return BaseDirectory.Document;
}

function getCharactersSubDir(): string {
	return 'characters';
}

function getCharactersStoragePath(fileName: string): string {
	return `${getCharactersSubDir()}/${fileName}`;
}

const LOCAL_STORAGE_PREFIX = 'novel-proofreader:';

async function migrateFromDocumentDir(subDir: string): Promise<void> {
	try {
		const oldBaseDir = BaseDirectory.Document;
		const newBaseDir = getBaseDir();
		if (oldBaseDir === newBaseDir) return;
		const oldDirExists = await exists(subDir, { baseDir: oldBaseDir });
		if (!oldDirExists) return;
		const files = await readDir(subDir, { baseDir: oldBaseDir });
		for (const file of files) {
			if (!file.name || file.isDirectory) continue;
			const filePath = `${subDir}/${file.name}`;
			try {
				const content = await readTextFile(filePath, { baseDir: oldBaseDir });
				await writeTextFile(filePath, content, { baseDir: newBaseDir });
				logger.file(`[migrate] Migrated ${filePath} from Document to LocalData`);
			} catch (e) {
				logger.errorGeneric(`[migrate] Failed to migrate ${filePath}:`, e);
			}
		}
	} catch (e) {
		logger.errorGeneric('[migrate] Migration from Document dir failed:', e);
	}
}

async function ensureCharactersDirectory(): Promise<boolean> {
	if (!isTauri()) {
		logger.warn('characterConfigStorage - Not in Tauri environment, skipping ensureCharactersDirectory');
		return false;
	}
	try {
		const baseDir = getBaseDir();
		const charactersPath = getCharactersSubDir();
		const dirExists = await exists(charactersPath, { baseDir });
		if (!dirExists) {
			await mkdir(charactersPath, { baseDir, recursive: true });
		}
		await migrateFromDocumentDir(charactersPath);
		return true;
	} catch (e) {
		logger.errorGeneric('characterConfigStorage - Failed to create characters directory:', e);
		return false;
	}
}

async function loadCharacterConfigFromTauri(fileName: string): Promise<string | null> {
	await ensureCharactersDirectory();
	const fullPath = getCharactersStoragePath(fileName);
	const baseDir = getBaseDir();
	const fileExists = await exists(fullPath, { baseDir });
	if (fileExists) {
		return await readTextFile(fullPath, { baseDir });
	}
	return null;
}

async function saveCharacterConfigToStorage(fileName: string, content: string): Promise<boolean> {
	if (isTauri()) {
		try {
			await ensureCharactersDirectory();
			const fullPath = getCharactersStoragePath(fileName);
			const baseDir = getBaseDir();
			logger.file('Saving character config to:', fullPath, 'baseDir:', baseDir);
			logger.file('Content length:', content.length);
			await writeTextFile(fullPath, content, { baseDir });
			logger.file('Save successful');
			return true;
		} catch (e) {
			logger.warn('[characterConfigStorage]', 'Tauri storage failed, falling back to localStorage:', e);
		}
	}
	try {
		localStorage.setItem(LOCAL_STORAGE_PREFIX + fileName, content);
		logger.file('Saved character config to localStorage:', fileName);
		return true;
	} catch (e) {
		logger.errorGeneric('[characterConfigStorage]', 'Failed to save character config:', e);
		return false;
	}
}

export async function loadCharacterConfigFromStorage(fileName: string): Promise<string | null> {
	if (isTauri()) {
		try {
			const content = await loadCharacterConfigFromTauri(fileName);
			if (content) {
				logger.file('Loaded character config from Tauri storage:', fileName);
				return content;
			}
		} catch (e) {
			logger.warn('[characterConfigStorage]', 'Tauri storage load failed, falling back to localStorage:', e);
		}
	}
	try {
		const content = localStorage.getItem(LOCAL_STORAGE_PREFIX + fileName);
		if (content) {
			logger.file('Loaded character config from localStorage:', fileName);
			return content;
		}
		logger.file('Character config not found:', fileName);
		return null;
	} catch (e) {
		logger.errorGeneric('[characterConfigStorage]', 'Failed to load character config:', e);
		return null;
	}
}

export function getCharacterConfigFileName(novelName: string): string {
	return `${sanitizeNovelFilename(novelName)}-characters.json`;
}

export async function createCharacterTemplate(novelName: string): Promise<boolean> {
	try {
		const fileName = getCharacterConfigFileName(novelName);
		const emptyCharacters: import('../types').CharacterInfo[] = [];
		const content = JSON.stringify(emptyCharacters, null, 2);
		logger.file('Creating character template for novel:', novelName, 'fileName:', fileName);
		return await saveCharacterConfigToStorage(fileName, content);
	} catch (e) {
		logger.errorGeneric('[characterConfigStorage]', 'Failed to create character template:', e);
		return false;
	}
}
