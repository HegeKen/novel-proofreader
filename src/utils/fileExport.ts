import type { Novel } from '../types';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, exists, readTextFile, mkdir, readDir, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import { logger } from './logger';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

function getBaseDir(): BaseDirectory {
  return BaseDirectory.Document;
}

function getNovelsSubDir(): string {
  return 'novels';
}

function getNovelsStoragePath(fileName: string): string {
  return `${getNovelsSubDir()}/${fileName}`;
}

function getCharactersSubDir(): string {
  return 'characters';
}

function getCharactersStoragePath(fileName: string): string {
  return `${getCharactersSubDir()}/${fileName}`;
}

export function ensureTxtFilename(fileName: string): string {
  return fileName.toLowerCase().endsWith('.txt') ? fileName : `${fileName}.txt`;
}

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

export async function ensureNovelsDirectory(): Promise<boolean> {
  if (!isTauri()) {
    logger.warn('fileExport - Not in Tauri environment, skipping ensureNovelsDirectory');
    return false;
  }
  try {
    const baseDir = getBaseDir();
    const novelsPath = getNovelsSubDir();
    const dirExists = await exists(novelsPath, { baseDir });
    if (!dirExists) {
      await mkdir(novelsPath, { baseDir, recursive: true });
    }
    await migrateFromDocumentDir(novelsPath);
    return true;
  } catch (e) {
    logger.errorGeneric('fileExport - Failed to create novels directory:', e);
    return false;
  }
}

export async function ensureCharactersDirectory(): Promise<boolean> {
  if (!isTauri()) {
    logger.warn('fileExport - Not in Tauri environment, skipping ensureCharactersDirectory');
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
    logger.errorGeneric('fileExport - Failed to create characters directory:', e);
    return false;
  }
}

const LOCAL_STORAGE_PREFIX = 'novel-proofreader:';

async function loadFromTauri(fileName: string): Promise<string | null> {
  await ensureCharactersDirectory();
  const fullPath = getCharactersStoragePath(fileName);
  const baseDir = getBaseDir();
  const fileExists = await exists(fullPath, { baseDir });
  if (fileExists) {
    return await readTextFile(fullPath, { baseDir });
  }
  return null;
}

export async function saveCharacterConfigToStorage(fileName: string, content: string): Promise<boolean> {
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
      logger.warn('[fileExport]', 'Tauri storage failed, falling back to localStorage:', e);
    }
  }
  try {
    localStorage.setItem(LOCAL_STORAGE_PREFIX + fileName, content);
    logger.file('Saved character config to localStorage:', fileName);
    return true;
  } catch (e) {
    logger.errorGeneric('[fileExport]', 'Failed to save character config:', e);
    return false;
  }
}

export async function loadCharacterConfigFromStorage(fileName: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const content = await loadFromTauri(fileName);
      if (content) {
        logger.file('Loaded character config from Tauri storage:', fileName);
        return content;
      }
    } catch (e) {
      logger.warn('[fileExport]', 'Tauri storage load failed, falling back to localStorage:', e);
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
    logger.errorGeneric('[fileExport]', 'Failed to load character config:', e);
    return null;
  }
}

export function getCharacterConfigFileName(novelName: string): string {
  const safeName = novelName.replace(/[\\/:*?"<>|]/g, "_");
  return `${safeName}-characters.json`;
}

// ==================== 角色检测相关类型和常量 ====================

export interface DetectedCharacter {
  name: string;
  frequency: number;
  confidence: number; // 0-1，综合可信度
  evidence: string[]; // 检测依据示例
  contextPatterns: Record<string, number>; // 上下文模式统计
  aliases?: string[]; // 检测到的别名
}

// 常见中文姓氏集合
const SURNAME_SET = new Set([
  '赵','钱','孙','李','周','吴','郑','王','冯','陈','褚','卫','蒋','沈','韩','杨',
  '朱','秦','尤','许','何','吕','施','张','孔','曹','严','华','金','魏','陶','姜',
  '戚','谢','邹','喻','柏','水','窦','章','云','苏','潘','葛','奚','范','彭','郎',
  '鲁','韦','昌','马','苗','凤','花','方','俞','任','袁','柳','酆','鲍','史','唐',
  '费','廉','岑','薛','雷','贺','倪','汤','滕','殷','罗','毕','郝','邬','安','常',
  '乐','于','时','傅','皮','卞','齐','康','伍','余','元','卜','顾','孟','平','黄',
  '和','穆','萧','尹','姚','邵','湛','汪','祁','毛','禹','狄','米','贝','明','臧',
  '计','伏','成','戴','谈','宋','茅','庞','熊','纪','舒','屈','项','祝','董','梁',
  '杜','阮','蓝','闵','席','季','麻','强','贾','路','娄','危','江','童','颜','郭',
  '梅','盛','林','刁','钟','徐','邱','骆','高','夏','蔡','田','樊','胡','凌','霍',
  '虞','万','支','柯','昝','管','卢','莫','经','房','裘','缪','干','解','应','宗',
  '丁','宣','贲','邓','郁','单','杭','洪','包','诸','左','石','崔','吉','钮','龚',
  '程','嵇','邢','滑','裴','陆','荣','翁','荀','羊','於','惠','甄','曲','家','封',
  '芮','羿','储','靳','汲','邴','糜','松','井','段','富','巫','乌','焦','巴','弓',
  '牧','隗','山','谷','车','侯','宓','蓬','全','郗','班','仰','秋','仲','伊','宫',
  '宁','仇','栾','暴','甘','钭','厉','戎','祖','武','符','刘','景','詹','束','龙',
  '叶','幸','司','韶','郜','黎','蓟','薄','印','宿','白','怀','蒲','邰','从','鄂',
  '索','咸','籍','赖','卓','蔺','屠','蒙','池','乔','阴','鬱','胥','能','苍','双',
  '闻','莘','党','翟','谭','贡','劳','逄','姬','申','扶','堵','冉','宰','郦','雍',
  '卻','璩','桑','桂','濮','牛','寿','通','边','扈','燕','冀','郏','浦','尚','农',
  '温','别','庄','晏','柴','瞿','阎','充','慕','连','茹','习','宦','艾','鱼','容',
  '向','古','易','慎','戈','廖','庾','终','暨','居','衡','步','都','耿','满','弘',
  '匡','国','文','寇','广','禄','阙','东','欧','殳','沃','利','蔚','越','夔','隆',
  '师','巩','厍','聂','晁','勾','敖','融','冷','訾','辛','阚','那','简','饶','空',
  '曾','毋','沙','乜','养','鞠','须','丰','巢','关','蒯','相','查','后','荆','红',
  '游','竺','权','逯','盖','益','桓','公','万俟','司马','上官','欧阳','夏侯','诸葛',
  '闻人','东方','赫连','皇甫','尉迟','公羊','澹台','公冶','宗政','濮阳','淳于','单于',
  '太叔','申屠','公孙','仲孙','轩辕','令狐','钟离','宇文','长孙','慕容','鲜于','闾丘',
  '司徒','司空','丌官','司寇','仉','督','子车','颛孙','端木','巫马','公西','漆雕',
  '乐正','壤驷','公良','拓跋','夹谷','宰父','谷梁','晋','楚','闫','法','汝','鄢',
  '涂','钦','段干','百里','东郭','南门','呼延','归','海','羊舌','微生','岳','帅','缑',
  '亢','况','郈','有','琴','梁丘','左丘','东门','西门','商','牟','佘','佴','伯','赏',
  '南宫','墨','哈','谯','笪','年','爱','阳','佟','第五','言','福'
]);

// 常见复姓（2字）
const COMPOUND_SURNAMES = new Set([
  '万俟','司马','上官','欧阳','夏侯','诸葛','闻人','东方','赫连','皇甫','尉迟',
  '公羊','澹台','公冶','宗政','濮阳','淳于','单于','太叔','申屠','公孙','仲孙',
  '轩辕','令狐','钟离','宇文','长孙','慕容','鲜于','闾丘','司徒','司空','丌官',
  '司寇','子车','颛孙','端木','巫马','公西','漆雕','乐正','壤驷','公良','拓跋',
  '夹谷','宰父','谷梁','段干','百里','东郭','南门','呼延','羊舌','微生','梁丘',
  '左丘','东门','西门','南宫'
]);

// 角色指示词
const ROLE_INDICATORS = [
  '说道','说','问','答','喊','叫','嚷','喝道','冷笑道','笑道','怒道','叹道',
  '叫道','吩咐','命令','让','令','派','托','求','请','劝','安慰','责备','称赞',
  '看着','望着','盯着','瞪着','瞧着','瞥见','遇见','遇到','看见','见到','发现',
  '想起','想到','觉得','认为','心想','暗想','寻思','思忖','琢磨',
  '走来','走来','跑来','追来','赶来','离开','坐下','站起','跪下','躺下',
  '手持','手握','腰悬','背负','头戴','身穿','披着','围着',
  '的师父','的徒弟','的师兄','的师弟','的师姐','的师妹','的兄长','的妹妹',
  '的父亲','的母亲','的儿子','的女儿','的丈夫','的妻子','的朋友','的仇人',
  '教主','掌门','帮主','岛主','宫主','庄主','堡主','门主','寨主',
  '大侠','剑客','刀客','侠客','英雄','高手','前辈','晚辈','少侠','女侠',
  '公公','婆婆','先生','夫人','小姐','少爷','姑娘','丫头','小子','老汉',
  '和尚','道士','尼姑','僧人','喇嘛','神医','毒手','怪侠','魔头','妖女'
];

// 非角色过滤词
const NON_ROLE_INDICATORS = [
  '叫做','称为','名曰','名叫','名字是',
  '是一种','属于','产于','生长在','用于',
  '位于','城','县','省','国','山','河','湖','海',
  '年','月','日','时','刻','朝代','世纪',
  '公司','集团','店','铺','楼','阁','殿','寺','庙','观',
  '秘籍','功法','招式','剑法','刀法','拳法','掌法','内功','心法'
];

// ==================== 第一层：基础候选提取 ====================

function isValidNameChars(str: string): boolean {
  return /^[\u4e00-\u9fa5·]+$/.test(str) && str.length >= 2 && str.length <= 4;
}

function extractCandidates(text: string): Map<string, number> {
  const candidates = new Map<string, number>();
  
  // 优化：使用正则表达式批量提取，避免逐字符遍历
  // 匹配复姓 + 2-4 个汉字 或 单姓 + 2-4 个汉字
  const compoundSurnamePattern = Array.from(COMPOUND_SURNAMES).map(escapeRegex).join('|');
  const surnamePattern = Array.from(SURNAME_SET).map(escapeRegex).join('');
  const pattern = `([${surnamePattern}](?:[\\u4e00-\\u9fa5]{1,3})|(?:${compoundSurnamePattern})(?:[\\u4e00-\\u9fa5]{1,2}))`;
  
  try {
    const regex = new RegExp(pattern, 'g');
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      const name = match[0];
      if (isValidNameChars(name)) {
        candidates.set(name, (candidates.get(name) || 0) + 1);
      }
    }
  } catch {
    // 如果正则表达式过于复杂（文本太长），回退到分块处理
    logger.warn('[角色检测] 正则表达式过于复杂，启用分块处理');
    const CHUNK_SIZE = 100000;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      const chunk = text.slice(i, i + CHUNK_SIZE);
      const chunkCandidates = extractCandidates(chunk);
      for (const [name, freq] of chunkCandidates) {
        candidates.set(name, (candidates.get(name) || 0) + freq);
      }
    }
  }
  
  return candidates;
}

// 辅助函数：转义正则表达式特殊字符
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== 第二层：上下文验证 ====================

function validateByContext(text: string, candidates: Map<string, number>): Map<string, DetectedCharacter> {
  const results = new Map<string, DetectedCharacter>();
  
  // 优化：按频率排序，只处理高频候选项，避免对大量低频候选进行昂贵匹配
  const sortedCandidates = Array.from(candidates.entries())
    .filter(([, freq]) => freq >= 3)
    .sort((a, b) => b[1] - a[1]);
  
  // 限制处理的候选数量，超过1000个高频候选时进行采样
  const MAX_CANDIDATES = 1000;
  const candidatesToProcess = sortedCandidates.length > MAX_CANDIDATES
    ? sortedCandidates.slice(0, MAX_CANDIDATES)
    : sortedCandidates;
  
  logger.debug(`[上下文验证] 需处理 ${candidatesToProcess.length} 个候选（原始 ${sortedCandidates.length} 个）`);

  // 预编译非角色指示词正则
  const nonRoleRegexes = NON_ROLE_INDICATORS.map(ind => new RegExp(ind));
  
  for (const [name, freq] of candidatesToProcess) {
    const patterns: Record<string, number> = {};
    let confidence = 0;
    const evidence: string[] = [];
    
    const regex = new RegExp(escapeRegex(name), 'g');
    let match;
    let roleScore = 0;
    let nonRoleScore = 0;
    let totalMatches = 0;
    
    while ((match = regex.exec(text)) !== null) {
      totalMatches++;
      const start = Math.max(0, match.index - 15);
      const end = Math.min(text.length, match.index + name.length + 15);
      const context = text.substring(start, end);
      
      for (const indicator of ROLE_INDICATORS) {
        if (context.includes(indicator)) {
          roleScore++;
          patterns[`near_${indicator}`] = (patterns[`near_${indicator}`] || 0) + 1;
          if (evidence.length < 3) evidence.push(context.replace(/\n/g, ''));
        }
      }
      
      for (const indRegex of nonRoleRegexes) {
        if (indRegex.test(context)) {
          nonRoleScore++;
        }
      }
      
      // 优化：限制匹配次数，避免对高频词过度匹配
      if (totalMatches >= 100) break;
    }
    
    if (totalMatches === 0) continue;
    
    confidence += Math.min(freq / 50, 0.3);
    confidence += Math.min(roleScore / totalMatches * 0.5, 0.4);
    confidence -= Math.min(nonRoleScore / totalMatches * 0.5, 0.3);
    
    if (name.length === 2 || name.length === 3) confidence += 0.1;
    if (name.length >= 3 && COMPOUND_SURNAMES.has(name.substring(0, 2))) {
      confidence += 0.1;
    }
    
    confidence = Math.max(0, Math.min(1, confidence));
    
    if (confidence > 0.3) {
      results.set(name, {
        name,
        frequency: freq,
        confidence,
        evidence,
        contextPatterns: patterns
      });
    }
  }
  
  return results;
}

// ==================== 第三层：共现网络增强 ====================

function enhanceByCooccurrence(
  text: string, 
  validated: Map<string, DetectedCharacter>
): Map<string, DetectedCharacter> {
  const enhanced = new Map(validated);
  
  // 优化：分块处理大文本，避免一次性分割过长的文本
  const CHUNK_SIZE = 500000;
  const segments: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    const chunk = text.slice(i, i + CHUNK_SIZE);
    segments.push(...chunk.split(/[。！？\n]+/).filter(s => s.length > 10));
  }
  
  const cooccurrence = new Map<string, Set<string>>();
  const names = Array.from(validated.keys());
  
  // 优化：限制处理的段落数量
  const MAX_SEGMENTS = 5000;
  const segmentsToProcess = segments.length > MAX_SEGMENTS
    ? segments.slice(0, MAX_SEGMENTS)
    : segments;
  
  logger.debug(`[共现增强] 处理 ${segmentsToProcess.length} 个段落`);
  
  for (const segment of segmentsToProcess) {
    // 优化：使用 Set 快速去重
    const presentSet = new Set<string>();
    for (const name of names) {
      if (segment.includes(name)) presentSet.add(name);
    }
    const present = Array.from(presentSet);
    
    // 优化：只处理共现数量较多的段落
    if (present.length < 2) continue;
    
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i], b = present[j];
        if (!cooccurrence.has(a)) cooccurrence.set(a, new Set());
        if (!cooccurrence.has(b)) cooccurrence.set(b, new Set());
        cooccurrence.get(a)!.add(b);
        cooccurrence.get(b)!.add(a);
      }
    }
  }
  
  for (const [name, data] of enhanced) {
    const cooccur = cooccurrence.get(name);
    if (cooccur && cooccur.size >= 2) {
      data.confidence = Math.min(1, data.confidence + 0.1 * Math.min(cooccur.size, 5));
      data.contextPatterns['cooccurrence_count'] = cooccur.size;
    }
  }
  
  return enhanced;
}

// ==================== 第四层：称谓/别名归并 ====================

function extractContexts(text: string, keyword: string, count: number): string[] {
  const contexts: string[] = [];
  const regex = new RegExp(keyword, 'g');
  let match;
  while ((match = regex.exec(text)) !== null && contexts.length < count) {
    const start = Math.max(0, match.index - 10);
    const end = Math.min(text.length, match.index + keyword.length + 10);
    contexts.push(text.substring(start, end));
  }
  return contexts;
}

function hasSimilarContext(ctxs1: string[], ctxs2: string[]): boolean {
  const words1 = new Set(ctxs1.join('').split(''));
  const words2 = new Set(ctxs2.join('').split(''));
  let common = 0;
  for (const w of words1) if (words2.has(w)) common++;
  return common / Math.max(words1.size, words2.size) > 0.3;
}

function detectAliases(
  text: string,
  characters: Map<string, DetectedCharacter>
): Map<string, DetectedCharacter> {
  const result = new Map(characters);
  
  const honorificPatterns = [
    { suffix: ['哥','兄','弟','妹','姐','爷','叔','伯','婶','姨','姑'], weight: 0.8 },
    { prefix: ['小','老','大'], weight: 0.7 },
    { suffix: ['公子','姑娘','小姐','少爷','夫人','先生','师傅','师父','师叔','师伯','师兄','师弟','师姐','师妹'], weight: 0.9 },
    { suffix: ['掌门','教主','帮主','岛主','宫主','庄主','堡主','门主','寨主'], weight: 0.85 },
    { suffix: ['侠','客','僧','道','尼','翁','婆','叟','妪'], weight: 0.75 }
  ];
  
  for (const [name, data] of characters) {
    if (name.length < 2) continue;
    
    const surname = name[0];
    const lastChar = name[name.length - 1];
    
    for (const pattern of honorificPatterns) {
      if (pattern.suffix) {
        for (const suf of pattern.suffix) {
          const alias1 = surname + suf;
          const alias2 = lastChar + suf;
          
          for (const alias of [alias1, alias2]) {
            if (alias === name) continue;
            const count = (text.match(new RegExp(alias, 'g')) || []).length;
            if (count >= 3) {
              const aliasContexts = extractContexts(text, alias, 3);
              const nameContexts = extractContexts(text, name, 3);
              
              if (hasSimilarContext(aliasContexts, nameContexts)) {
                data.contextPatterns[`alias_${alias}`] = count;
                if (!data.aliases) data.aliases = [];
                data.aliases.push(alias);
              }
            }
          }
        }
      }
    }
  }
  
  return result;
}

// ==================== 公共过滤词集合 ====================

export const MODAL_PARTICLES = new Set([
  // 语气词
  '的', '了', '吗', '呢', '吧', '啊', '呀', '哇', '哦', '诶', '嘛', '咯', '咧', '嘿嘿',
  '罢了', '而已', '等等', '一些', '一点', '很多', '非常', '十分', '特别', '唔', '之后',
  '很', '太', '极', '最', '更', '还', '也', '又', '再', '就', '都', '只', '啪', '呜',
  '才', '刚', '正', '在', '着', '过', '会', '能', '可以', '应该', '要', '噗嗤', '嘶', '滋',
  '想', '觉得', '认为', '知道', '说', '看', '听', '走', '来', '去', '有', '是', '哈哈哈',
  '不', '没', '无', '一个', '这个', '那个', '什么', '怎么', '为什么', '因为', '而且', '咚',
  '所以', '但是', '可是', '然而', '虽然', '如果', '要是', '只要', '只有', '无论', '啧',
  '那天', '时候', '一下', '一起', '一眼', '一般', '手机', '电话', '声音', '这时',
  '之上', '之下', '下一秒', '一句', '随后', '其实', '那一刻', '女人', '男人',

  // 常用动词
  '做', '弄', '搞', '拿', '放', '给', '吃', '喝', '穿', '睡', '写', '画', '唱', '跳', '跑',
  '坐', '站', '躺', '跪', '爬', '骑', '开', '关', '买', '卖', '借', '还', '送', '收', '发',
  '取', '摆', '挂', '贴', '盖', '修', '洗', '擦', '扫', '拖', '搬', '抬', '扛', '推', '拉',
  '抱', '背', '提', '拎', '举', '扔', '抛', '丢', '捡', '拾', '挖', '种', '浇', '剪', '切',
  '砍', '劈', '烧', '煮', '蒸', '炒', '炖', '煎', '烤', '炸', '拼', '拆', '装', '建', '造',
  '卸', '运', '寄', '传', '递', '找', '寻', '搜', '查', '望', '瞧', '盯', '瞄', '闻', '尝',
  '摸', '碰', '握', '抓', '牵', '按', '压', '拍', '敲', '撞', '摔', '掉', '落', '飞', '蹦',
  '游', '滑', '滚', '转', '绕', '拐', '弯', '直', '斜', '歪', '倒', '立', '卧', '趴', '蹲',

  // 介词
  '在', '从', '向', '对', '跟', '同', '和', '比', '被', '把', '将', '让', '使', '给',
  '为', '为了', '由于', '关于', '对于', '至于', '除了', '通过', '按照', '根据', '顺着',
  '沿着', '朝着', '对着', '向着', '自从', '至', '自', '由', '凭', '依', '靠',

  // 量词
  '个', '只', '条', '件', '本', '张', '把', '根', '支', '辆', '台', '架', '艘', '座',
  '栋', '间', '扇', '块', '片', '粒', '颗', '滴', '杯', '碗', '盆', '瓶', '桶', '袋',
  '箱', '包', '捆', '束', '串', '对', '双', '副', '套', '组', '群', '批', '伙', '帮',
  '队', '排', '列', '行', '层', '面', '顶', '枝', '节', '段', '截', '团', '堆', '簇',
  '丛', '道', '缕', '丝', '点', '些', '份', '位', '名', '员', '家', '户', '头', '匹',
  '峰', '部', '册', '封', '幅', '帧', '首', '曲', '篇', '章', '卷', '页', '格', '级',
  '阶', '等', '类', '种', '样', '型', '式', '款', '号', '码', '量', '度', '率', '值',
  '数', '次', '回', '趟', '遍', '番', '场', '事', '项', '目',

  // 常用副词
  '已经', '曾经', '正在', '将要', '刚刚', '立刻', '马上', '忽然', '突然', '渐渐',
  '慢慢', '缓缓', '迅速', '快速', '悄悄', '偷偷', '默默', '静静', '纷纷', '陆续',
  '不断', '经常', '常常', '时常', '偶尔', '有时', '总是', '一直', '从来', '始终',
  '永远', '暂时', '临时', '长久', '赶紧',

  // 常用连词
  '并且', '以及', '或者', '还是', '不但', '不仅', '而且', '何况', '况且', '尽管', '即使',
  '假如', '倘若', '万一', '除非', '否则', '不管', '以便', '以免', '免得', '省得', '因此', '因而',

  // 拟声词
  '哈哈', '呵呵', '嘻嘻', '呜呜', '哇哇', '啊啊', '哎呀', '哎哟', '唉', '嗯',
  '嗡', '鸣', '嘀', '嗒', '嘟', '噜', '呼', '吸', '哼', '咳', '喘', '嘘', '咻',
  '哧', '叮', '锵', '铛', '隆', '轰', '鸣', '吠', '喵', '汪',

  // 其他常用词
  '我们', '你们', '他们', '它们', '大家', '自己', '别人', '人家', '多少', '几',
  '哪', '谁', '哪儿', '这里', '那里', '到处', '四处', '现在', '过去', '将来',
  '刚才', '今天', '明天', '昨天', '后天', '前天', '最近', '以前', '以后', '之前',
  '目前', '当前', '当时', '一定', '必须', '可能', '也许', '大概', '大约', '差不多', '几乎',
  '全部', '所有', '一切', '任何', '每个', '各个', '有些', '有的', '没有', '不少',
  '许多', '大量', '少量', '稍微', '略微', '比较', '相当'
]);

// ==================== 第五层：过滤拆分姓名 ====================

function filterSubstringNames(validated: Map<string, DetectedCharacter>): Map<string, DetectedCharacter> {
  const result = new Map<string, DetectedCharacter>();
  const names = Array.from(validated.keys()).sort((a, b) => b.length - a.length);
  
  for (const name of names) {
    const data = validated.get(name)!;
    let isSubstring = false;
    
    for (const otherName of names) {
      if (otherName === name) continue;
      if (otherName.length <= name.length) continue;
      
      if (otherName.includes(name)) {
        isSubstring = true;
        break;
      }
    }
    
    if (!isSubstring) {
      result.set(name, data);
    } else {
      logger.debug(`[角色检测] 过滤拆分姓名: "${name}" (是 "${names.find(n => n.includes(name) && n !== name)}" 的子串)`);
    }
  }
  
  return result;
}

// ==================== 高频词汇辅助检测 ====================

export interface HighFrequencyWord {
  word: string;
  frequency: number;
  isPossibleName: boolean;
  evidence: string[];
}

export function detectHighFrequencyWords(text: string, minFrequency: number = 10): HighFrequencyWord[] {
  logger.debug(`[高频词汇检测] 开始扫描，文本长度: ${text.length} 字符`);
  const startTime = Date.now();
  
  const wordCount = new Map<string, number>();
  const wordContexts = new Map<string, string[]>();
  
  // 大文本分块处理：每块 100KB，避免一次性处理过大文本
  const CHUNK_SIZE = 100000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    // 查找块边界，避免在词语中间切割
    let end = Math.min(i + CHUNK_SIZE, text.length);
    if (end < text.length) {
      // 向前查找最近的 4 字符边界
      const searchStart = Math.max(i, end - 10);
      for (let j = end - 1; j >= searchStart; j--) {
        if (/[\u4e00-\u9fa5]/.test(text[j])) {
          end = j + 1;
          break;
        }
      }
    }
    chunks.push(text.slice(i, end));
  }
  
  logger.debug(`[高频词汇检测] 文本分为 ${chunks.length} 个块`);
  
  // 使用 Set 进行快速过滤
  const modalParticleSet = new Set(MODAL_PARTICLES);
  const surnameSet = SURNAME_SET;
  const compoundSurnames = COMPOUND_SURNAMES;
  
  // 优化：预先编译正则表达式
  const wordRegex = /[\u4e00-\u9fa5]{2,4}/g;
  
  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const words = chunk.match(wordRegex) || [];
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      
      // 快速过滤：检查首字符是否在常用词中
      if (word.length >= 2 && modalParticleSet.has(word[0])) continue;
      
      // 优化：使用更快的计数方式
      const prevCount = wordCount.get(word);
      if (prevCount !== undefined) {
        wordCount.set(word, prevCount + 1);
      } else {
        wordCount.set(word, 1);
        wordContexts.set(word, []);
      }
      
      // 上下文只保留最多 3 个样本
      const contexts = wordContexts.get(word)!;
      if (contexts.length < 3) {
        const start = Math.max(0, i - 2);
        const end = Math.min(words.length, i + 3);
        contexts.push(words.slice(start, end).join(''));
      }
    }
  }
  
  logger.debug(`[高频词汇检测] 提取并统计完成，共 ${wordCount.size} 个不同词汇`);
  
  const results: HighFrequencyWord[] = [];
  for (const [word, freq] of wordCount) {
    if (freq < minFrequency) continue;
    
    const firstChar = word.charAt(0);
    
    const isPossibleName = (
      (surnameSet.has(firstChar) || compoundSurnames.has(word.substring(0, 2))) &&
      /[\u4e00-\u9fa5]/.test(word.charAt(1))
    );
    
    results.push({
      word,
      frequency: freq,
      isPossibleName,
      evidence: wordContexts.get(word) || []
    });
  }
  
  results.sort((a, b) => {
    // 可能为人名的优先显示
    if (a.isPossibleName && !b.isPossibleName) return -1;
    if (!a.isPossibleName && b.isPossibleName) return 1;
    // 同类型按频率排序
    return b.frequency - a.frequency;
  });
  
  const endTime = Date.now();
  logger.debug(`[高频词汇检测] 完成！发现 ${results.length} 个高频词，耗时 ${(endTime - startTime).toFixed(2)}ms`);
  logger.debug(`[高频词汇检测] 其中可能是人名的: ${results.filter(r => r.isPossibleName).length} 个`);
  
  return results;
}

// ==================== 主检测函数 ====================

export function detectCharactersFromText(text: string, minFrequency: number = 3): DetectedCharacter[] {
  logger.debug(`[角色检测] 开始扫描，文本长度: ${text.length} 字符`);
  const startTime = Date.now();
  
  logger.debug(`[角色检测] 阶段1/5: 提取候选角色...`);
  const candidates = extractCandidates(text);
  logger.debug(`[角色检测] 阶段1完成: 发现 ${candidates.size} 个候选角色`);
  
  logger.debug(`[角色检测] 阶段2/5: 上下文验证...`);
  let validated = validateByContext(text, candidates);
  logger.debug(`[角色检测] 阶段2完成: 通过验证 ${validated.size} 个角色`);
  
  logger.debug(`[角色检测] 阶段3/5: 共现网络增强...`);
  validated = enhanceByCooccurrence(text, validated);
  logger.debug(`[角色检测] 阶段3完成: 增强 ${validated.size} 个角色的置信度`);
  
  logger.debug(`[角色检测] 阶段4/5: 称谓/别名归并...`);
  validated = detectAliases(text, validated);
  logger.debug(`[角色检测] 阶段4完成: 完成别名归并`);

  logger.debug(`[角色检测] 阶段5/5: 过滤拆分姓名...`);
  validated = filterSubstringNames(validated);
  logger.debug(`[角色检测] 阶段5完成: 剩余 ${validated.size} 个角色`);

  logger.debug(`[角色检测] 阶段6/6: 过滤常用词...`);
  const filteredResults = new Map<string, DetectedCharacter>();
  for (const [name, data] of validated) {
    let containsCommonWord = false;
    for (const particle of MODAL_PARTICLES) {
      if (name.includes(particle)) {
        containsCommonWord = true;
        break;
      }
    }
    if (!containsCommonWord) {
      filteredResults.set(name, data);
    } else {
      logger.debug(`[角色检测] 过滤常用词: "${name}"`);
    }
  }
  logger.debug(`[角色检测] 阶段6完成: 剩余 ${filteredResults.size} 个角色`);

  const results: DetectedCharacter[] = [];
  for (const [, data] of filteredResults) {
    if (data.frequency >= minFrequency && data.confidence >= 0.4) {
      results.push(data);
    }
  }
  
  results.sort((a, b) => b.frequency - a.frequency);
  
  const endTime = Date.now();
  logger.debug(`[角色检测] 扫描完成！共检测到 ${results.length} 个角色，耗时 ${(endTime - startTime).toFixed(2)}ms`);
  if (results.length > 0) {
    logger.debug(`[角色检测] Top 5 角色: ${results.slice(0, 5).map(r => `${r.name}(频率: ${r.frequency})`).join(', ')}`);
  }
  
  return results;
}

export async function createCharacterTemplate(novelName: string): Promise<boolean> {
  try {
    const fileName = getCharacterConfigFileName(novelName);
    const emptyCharacters: import('../types').CharacterInfo[] = [];
    const content = JSON.stringify(emptyCharacters, null, 2);
    logger.file('Creating character template for novel:', novelName, 'fileName:', fileName);
    return await saveCharacterConfigToStorage(fileName, content);
  } catch (e) {
    logger.errorGeneric('[fileExport]', 'Failed to create character template:', e);
    return false;
  }
}

export async function exportToTxt(novel: Novel): Promise<boolean> {
  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const content = `《${novel.name}》\n\n${novel.fullText}`;
    const filePath = await save({
      defaultPath: `${novel.name}.txt`,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    });
    if (filePath) {
      await writeFile(filePath, new TextEncoder().encode(content));
      logger.file('Exported novel to:', filePath);
      return true;
    }
    return false;
  } catch (e) {
    logger.errorGeneric('[fileExport]', 'Failed to export novel:', e);
    return false;
  }
}

export async function exportToFile(content: string, fileName: string): Promise<"success" | "fallback" | false> {
  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const filePath = await save({
      defaultPath: fileName,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    });
    if (filePath) {
      await writeFile(filePath, new TextEncoder().encode(content));
      logger.file('Exported file to:', filePath);
      return "success";
    }
    return false;
  } catch (e) {
    logger.errorGeneric('[fileExport]', 'Failed to export file:', e);
    // 尝试 fallback 到下载
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return "fallback";
  }
}

export async function exportCharactersToJson(_novelId: string, novelName: string, characters: import('../types').CharacterInfo[]): Promise<boolean> {
  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const content = JSON.stringify(characters, null, 2);
    const filePath = await save({
      defaultPath: `${novelName}-characters.json`,
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });
    if (filePath) {
      await writeFile(filePath, new TextEncoder().encode(content));
      logger.file('Exported characters to:', filePath);
      return true;
    }
    return false;
  } catch (e) {
    logger.errorGeneric('fileExport - Failed to export characters:', e);
    return false;
  }
}

// ==================== 小说存储相关函数 ====================

export async function loadNovelContent(fileName: string): Promise<string | null> {
  try {
    const fullPath = getNovelsStoragePath(fileName);
    const baseDir = getBaseDir();
    const content = await readTextFile(fullPath, { baseDir });
    logger.file('Loaded novel content from storage:', fileName);
    return content;
  } catch (e) {
    logger.errorGeneric('[fileExport]', 'Failed to load novel:', e);
    return null;
  }
}

export async function saveNovelToStorage(fileName: string, content: string): Promise<boolean> {
  try {
    await ensureNovelsDirectory();
    const fullPath = getNovelsStoragePath(fileName);
    const baseDir = getBaseDir();
    logger.proofread(`Saving to: ${fullPath} baseDir: ${baseDir}`);
    logger.proofread(`Content length: ${content.length}`);
    await writeTextFile(fullPath, content, { baseDir });
    logger.file('Save successful');
    return true;
  } catch (e) {
    logger.errorGeneric('[fileExport]', 'Failed to save novel to storage:', e);
    return false;
  }
}

export async function deleteNovelFromStorage(fileName: string): Promise<boolean> {
  try {
    const fullPath = getNovelsStoragePath(fileName);
    const baseDir = getBaseDir();
    const fileExists = await exists(fullPath, { baseDir });
    if (fileExists) {
      await remove(fullPath, { baseDir });
    }
    return true;
  } catch (e) {
    logger.errorGeneric('fileExport - Failed to delete novel from storage:', e);
    return false;
  }
}

export async function loadNovelsFromStorage(): Promise<string[]> {
  try {
    await ensureNovelsDirectory();
    const novelsPath = getNovelsSubDir();
    const baseDir = getBaseDir();
    const files = await readDir(novelsPath, { baseDir });
    const txtFiles = files.filter(f => f.name.toLowerCase().endsWith('.txt')).map(f => f.name);
    logger.file('Loaded novels from storage:', txtFiles);
    return txtFiles;
  } catch (e) {
    logger.errorGeneric('[fileExport]', 'Failed to load novels:', e);
    return [];
  }
}

export async function exportAllData(data: {
  novels: import('../types').Novel[];
  aiConfig: import('../types').AIConfig;
  apiUsage: import('../types').APIUsage;
  novelCategories: Record<string, import('../types').NovelCategory>;
  readingProgress: Record<string, {
    currentChapterIndex: number;
    currentParagraphIndex: number;
    readingStartTime: number;
    totalReadingTime: number;
  }>;
  ignoredWords: Record<string, string[]>;
  exportTime: string;
  version: string;
}): Promise<boolean> {
  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const content = JSON.stringify(data, null, 2);
    const filePath = await save({
      defaultPath: 'novel-proofreader-backup.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });
    if (filePath) {
      await writeFile(filePath, new TextEncoder().encode(content));
      logger.file('Exported all data to:', filePath);
      return true;
    }
    return false;
  } catch (e) {
    logger.errorGeneric('[fileExport]', 'Failed to export all data:', e);
    return false;
  }
}