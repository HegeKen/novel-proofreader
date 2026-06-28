// ============================================================
// CJK 变体字/部首字标准化
// 将 Unicode 中的康熙部首（U+2F00-U+2FDF）、CJK 部首补充（U+2E80-U+2EFF）
// 等特殊字符映射为现代通用标准汉字
// ============================================================

/**
 * 康熙部首 → 标准汉字映射表
 * U+2F00 ~ U+2FDF (共 214 个)
 */
const KANGXI_RADICAL_TO_STANDARD: Record<string, string> = {
	"\u2F00": "\u4E00", // ⼀ → 一
	"\u2F01": "\u4E28", // ⼁ → 丨
	"\u2F02": "\u4E36", // ⼂ → 丶
	"\u2F03": "\u4E3F", // ⼃ → 丿
	"\u2F04": "\u4E59", // ⼄ → 乙
	"\u2F05": "\u4E85", // ⼅ → 久 (or 亅 U+4E85)
	"\u2F06": "\u4E8C", // ⼆ → 二
	"\u2F07": "\u4EA0", // ⼇ → 亠
	"\u2F08": "\u4EBA", // ⼈ → 人
	"\u2F09": "\u513F", // ⼉ → 儿
	"\u2F0A": "\u5165", // ⼊ → 入
	"\u2F0B": "\u516B", // ⼋ → 八
	"\u2F0C": "\u5182", // ⼌ → 冂
	"\u2F0D": "\u5196", // ⼍ → 冖
	"\u2F0E": "\u51AB", // ⼎ → 冫
	"\u2F0F": "\u51E0", // ⼏ → 几
	"\u2F10": "\u51F5", // ⼐ → 凵
	"\u2F11": "\u5200", // ⼑ → 刀
	"\u2F12": "\u529B", // ⼒ → 力
	"\u2F13": "\u52F9", // ⼓ → 勹
	"\u2F14": "\u5315", // ⼔ → 匕
	"\u2F15": "\u531A", // ⼕ → 匚
	"\u2F16": "\u5338", // ⼖ → 匸
	"\u2F17": "\u5341", // ⼗ → 十
	"\u2F18": "\u535C", // ⼘ → 卜
	"\u2F19": "\u5369", // ⼙ → 卩
	"\u2F1A": "\u5382", // ⼚ → 厂
	"\u2F1B": "\u53B6", // ⼛ → 厶
	"\u2F1C": "\u53C8", // ⼜ → 又
	"\u2F1D": "\u53E3", // ⼝ → 口
	"\u2F1E": "\u56D7", // ⼞ → 囗
	"\u2F1F": "\u571F", // ⼟ → 土
	"\u2F20": "\u58EB", // ⼠ → 士
	"\u2F21": "\u5902", // ⼡ → 夂
	"\u2F22": "\u590A", // ⼢ → 夊
	"\u2F23": "\u5915", // ⼣ → 夕
	"\u2F24": "\u5927", // ⼤ → 大
	"\u2F25": "\u5973", // ⼥ → 女
	"\u2F26": "\u5B50", // ⼦ → 子
	"\u2F27": "\u5B80", // ⼧ → 宀
	"\u2F28": "\u5BF8", // ⼨ → 寸
	"\u2F29": "\u5C0F", // ⼩ → 小
	"\u2F2A": "\u5C22", // ⼪ → 尢
	"\u2F2B": "\u5C38", // ⼫ → 尸
	"\u2F2C": "\u5C6E", // ⼬ → 屮
	"\u2F2D": "\u5C71", // ⼭ → 山
	"\u2F2E": "\u5DDB", // ⼮ → 巛
	"\u2F2F": "\u5DE5", // ⼯ → 工
	"\u2F30": "\u5DF1", // ⼰ → 己
	"\u2F31": "\u5DFE", // ⼱ → 巾
	"\u2F32": "\u5E72", // ⼲ → 干
	"\u2F33": "\u5E7A", // ⼳ → 幺
	"\u2F34": "\u5E7F", // ⼴ → 广
	"\u2F35": "\u5EF4", // ⼵ → 廴
	"\u2F36": "\u5EFE", // ⼶ → 廾
	"\u2F37": "\u5F0B", // ⼷ → 弋
	"\u2F38": "\u5F13", // ⼸ → 弓
	"\u2F39": "\u5F50", // ⼹ → 彐
	"\u2F3A": "\u5F61", // ⼺ → 彡
	"\u2F3B": "\u5F73", // ⼻ → 彳
	"\u2F3C": "\u5FC3", // ⼼ → 心
	"\u2F3D": "\u6208", // ⼽ → 戈
	"\u2F3E": "\u6236", // ⼾ → 戶
	"\u2F3F": "\u624B", // ⼿ → 手
	"\u2F40": "\u652F", // ⽀ → 支
	"\u2F41": "\u6534", // ⽁ → 攴
	"\u2F42": "\u6587", // ⽂ → 文
	"\u2F43": "\u6597", // ⽃ → 斗
	"\u2F44": "\u65A4", // ⽄ → 斤
	"\u2F45": "\u65B9", // ⽅ → 方
	"\u2F46": "\u65E0", // ⽆ → 无
	"\u2F47": "\u65E5", // ⽇ → 日
	"\u2F48": "\u66F0", // ⽈ → 曰
	"\u2F49": "\u6708", // ⽉ → 月
	"\u2F4A": "\u6728", // ⽊ → 木
	"\u2F4B": "\u6B20", // ⽋ → 欠
	"\u2F4C": "\u6B62", // ⽌ → 止
	"\u2F4D": "\u6B79", // ⽍ → 歹
	"\u2F4E": "\u6BB3", // ⽎ → 殳
	"\u2F4F": "\u6BCB", // ⽏ → 毋
	"\u2F50": "\u6BD4", // ⽐ → 比
	"\u2F51": "\u6BDB", // ⽑ → 毛
	"\u2F52": "\u6C0F", // ⽒ → 氏
	"\u2F53": "\u6C14", // ⽓ → 气
	"\u2F54": "\u6C34", // ⽔ → 水
	"\u2F55": "\u706B", // ⽕ → 火
	"\u2F56": "\u722A", // ⽖ → 爪
	"\u2F57": "\u7236", // ⽗ → 父
	"\u2F58": "\u723B", // ⽘ → 爻
	"\u2F59": "\u723F", // ⽙ → 爿
	"\u2F5A": "\u7247", // ⽚ → 片
	"\u2F5B": "\u7259", // ⽛ → 牙
	"\u2F5C": "\u725B", // ⽜ → 牛
	"\u2F5D": "\u72AC", // ⽝ → 犬
	"\u2F5E": "\u7384", // ⽞ → 玄
	"\u2F5F": "\u7389", // ⽟ → 玉
	"\u2F60": "\u74DC", // ⽠ → 瓜
	"\u2F61": "\u74E6", // ⽡ → 瓦
	"\u2F62": "\u7518", // ⽢ → 甘
	"\u2F63": "\u751F", // ⽣ → 生
	"\u2F64": "\u7528", // ⽤ → 用
	"\u2F65": "\u7530", // ⽥ → 田
	"\u2F66": "\u758B", // ⽦ → 疋
	"\u2F67": "\u7592", // ⽧ → 疒
	"\u2F68": "\u7676", // ⽨ → 癶
	"\u2F69": "\u767D", // ⽩ → 白
	"\u2F6A": "\u76AE", // ⽪ → 皮
	"\u2F6B": "\u76BF", // ⽫ → 皿
	"\u2F6C": "\u76EE", // ⽬ → 目
	"\u2F6D": "\u77DB", // ⽭ → 矛
	"\u2F6E": "\u77E2", // ⽮ → 矢
	"\u2F6F": "\u77F3", // ⽯ → 石
	"\u2F70": "\u793A", // ⽰ → 示
	"\u2F71": "\u79B8", // ⽱ → 禸
	"\u2F72": "\u79BE", // ⽲ → 禾
	"\u2F73": "\u7A74", // ⽳ → 穴
	"\u2F74": "\u7ACB", // ⽴ → 立
	"\u2F75": "\u7AF9", // ⽵ → 竹
	"\u2F76": "\u7C73", // ⽶ → 米
	"\u2F77": "\u7CF8", // ⽷ → 糸
	"\u2F78": "\u7F36", // ⽸ → 缶
	"\u2F79": "\u7F51", // ⽹ → 网
	"\u2F7A": "\u7F8A", // ⽺ → 羊
	"\u2F7B": "\u7FBD", // ⽻ → 羽
	"\u2F7C": "\u8001", // ⽼ → 老
	"\u2F7D": "\u800C", // ⽽ → 而
	"\u2F7E": "\u8012", // ⽾ → 耒
	"\u2F7F": "\u8033", // ⽿ → 耳
	"\u2F80": "\u807F", // ⾀ → 聿
	"\u2F81": "\u8089", // ⾁ → 肉
	"\u2F82": "\u81E3", // ⾂ → 臣
	"\u2F83": "\u81EA", // ⾃ → 自
	"\u2F84": "\u81F3", // ⾄ → 至
	"\u2F85": "\u81FC", // ⾅ → 臼
	"\u2F86": "\u820C", // ⾆ → 舌
	"\u2F87": "\u821B", // ⾇ → 舛
	"\u2F88": "\u821F", // ⾈ → 舟
	"\u2F89": "\u826E", // ⾉ → 艮
	"\u2F8A": "\u8272", // ⾊ → 色
	"\u2F8B": "\u8278", // ⾋ → 艸
	"\u2F8C": "\u864D", // ⾌ → 虍
	"\u2F8D": "\u866B", // ⾍ → 虫
	"\u2F8E": "\u8840", // ⾎ → 血
	"\u2F8F": "\u884C", // ⾏ → 行
	"\u2F90": "\u8863", // ⾐ → 衣
	"\u2F91": "\u897E", // ⾑ → 襾
	"\u2F92": "\u898B", // ⾒ → 見
	"\u2F93": "\u89D2", // ⾓ → 角
	"\u2F94": "\u8A00", // ⾔ → 言
	"\u2F95": "\u8C37", // ⾕ → 谷
	"\u2F96": "\u8C46", // ⾖ → 豆
	"\u2F97": "\u8C55", // ⾗ → 豕
	"\u2F98": "\u8C78", // ⾘ → 豸
	"\u2F99": "\u8C9D", // ⾙ → 貝
	"\u2F9A": "\u8D64", // ⾚ → 赤
	"\u2F9B": "\u8D70", // ⾛ → 走
	"\u2F9C": "\u8DB3", // ⾜ → 足
	"\u2F9D": "\u8EAB", // ⾝ → 身
	"\u2F9E": "\u8ECA", // ⾞ → 車
	"\u2F9F": "\u8F9B", // ⾟ → 辛
	"\u2FA0": "\u8FB0", // ⾠ → 辰
	"\u2FA1": "\u8FB5", // ⾡ → 辵
	"\u2FA2": "\u9091", // ⾢ → 邑
	"\u2FA3": "\u9149", // ⾣ → 酉
	"\u2FA4": "\u91C6", // ⾤ → 釆
	"\u2FA5": "\u91CC", // ⾥ → 里
	"\u2FA6": "\u91D1", // ⾦ → 金
	"\u2FA7": "\u9577", // ⾧ → 長
	"\u2FA8": "\u9580", // ⾨ → 門
	"\u2FA9": "\u961C", // ⾩ → 阜
	"\u2FAA": "\u96B6", // ⾪ → 隶
	"\u2FAB": "\u96B9", // ⾫ → 隹
	"\u2FAC": "\u96E8", // ⾬ → 雨
	"\u2FAD": "\u9751", // ⾭ → 靑
	"\u2FAE": "\u975E", // ⾮ → 非
	"\u2FAF": "\u9762", // ⾯ → 面
	"\u2FB0": "\u9769", // ⾰ → 革
	"\u2FB1": "\u97CB", // ⾱ → 韋
	"\u2FB2": "\u97ED", // ⾲ → 韭
	"\u2FB3": "\u97F3", // ⾳ → 音
	"\u2FB4": "\u9801", // ⾴ → 頁
	"\u2FB5": "\u98A8", // ⾵ → 風
	"\u2FB6": "\u98DB", // ⾶ → 飛
	"\u2FB7": "\u98DF", // ⾷ → 食
	"\u2FB8": "\u9996", // ⾸ → 首
	"\u2FB9": "\u9999", // ⾹ → 香
	"\u2FBA": "\u99AC", // ⾺ → 馬
	"\u2FBB": "\u9AA8", // ⾻ → 骨
	"\u2FBC": "\u9AD8", // ⾼ → 高
	"\u2FBD": "\u9ADF", // ⾽ → 髟
	"\u2FBE": "\u9B25", // ⾾ → 鬥
	"\u2FBF": "\u9B2F", // ⾿ → 鬯
	"\u2FC0": "\u9B32", // ⿀ → 鬲
	"\u2FC1": "\u9B3C", // ⿁ → 鬼
	"\u2FC2": "\u9B5A", // ⿂ → 魚
	"\u2FC3": "\u9CE5", // ⿃ → 鳥
	"\u2FC4": "\u9E75", // ⿄ → 鹵
	"\u2FC5": "\u9E7F", // ⿅ → 鹿
	"\u2FC6": "\u9EA5", // ⿆ → 麥
	"\u2FC7": "\u9EBB", // ⿇ → 麻
	"\u2FC8": "\u9EC3", // ⿈ → 黃
	"\u2FC9": "\u9ECD", // ⿉ → 黍
	"\u2FCA": "\u9ED1", // ⿊ → 黑
	"\u2FCB": "\u9EF9", // ⿋ → 黹
	"\u2FCC": "\u9EFD", // ⿌ → 黻 (or 黽 U+9EFD)
	"\u2FCD": "\u9F0E", // ⿍ → 鼎
	"\u2FCE": "\u9F13", // ⿎ → 鼓
	"\u2FCF": "\u9F20", // ⿏ → 鼠
	"\u2FD0": "\u9F3B", // ⿐ → 鼻
	"\u2FD1": "\u9F4A", // ⿑ → 齊
	"\u2FD2": "\u9F52", // ⿒ → 齒
	"\u2FD3": "\u9F8D", // ⿓ → 龍
	"\u2FD4": "\u9F9C", // ⿔ → 龜
	"\u2FD5": "\u9FA0", // ⿕ → 龠
};

/**
 * CJK 部首补充 → 标准汉字映射表
 * U+2E80 ~ U+2EFF
 * 根据 Unicode Standard 16.0 官方映射关系构建
 */
const CJK_RADICAL_SUPPLEMENT_TO_STANDARD: Record<string, string> = {
	"\u2E80": "\u4E36", // ⺀ → 丶 (CJK RADICAL REPEAT)
	"\u2E81": "\u5382", // ⺁ → 厂 (CJK RADICAL CLIFF)
	"\u2E82": "\u4E5B", // ⺂ → 乛 (CJK RADICAL SECOND ONE)
	"\u2E83": "\u4E5A", // ⺃ → 乚 (CJK RADICAL SECOND TWO)
	"\u2E84": "\u4E59", // ⺄ → 乙 (CJK RADICAL SECOND THREE)
	"\u2E85": "\u4EBB", // ⺅ → 亻 (CJK RADICAL PERSON)
	"\u2E86": "\u5182", // ⺆ → 冂 (CJK RADICAL BOX)
	"\u2E87": "\u51E0", // ⺇ → 几 (CJK RADICAL TABLE)
	"\u2E88": "\u5200", // ⺈ → 刀 (CJK RADICAL KNIFE ONE)
	"\u2E89": "\u5202", // ⺉ → 刂 (CJK RADICAL KNIFE TWO)
	"\u2E8A": "\u535C", // ⺊ → 卜 (CJK RADICAL DIVINATION)
	"\u2E8B": "\u353E", // ⺋ → 㔾 (CJK RADICAL SEAL)
	"\u2E8C": "\u5C0F", // ⺌ → 小 (CJK RADICAL SMALL ONE)
	"\u2E8D": "\u5C0F", // ⺍ → 小 (CJK RADICAL SMALL TWO)
	"\u2E8E": "\u5C22", // ⺎ → 尢 (CJK RADICAL LAME ONE)
	"\u2E8F": "\u5C23", // ⺏ → 尣 (CJK RADICAL LAME TWO)
	"\u2E90": "\u5C22", // ⺐ → 尢 (CJK RADICAL LAME THREE)
	"\u2E91": "\u5C23", // ⺑ → 尣 (CJK RADICAL LAME FOUR)
	"\u2E92": "\u5DF3", // ⺒ → 巳 (CJK RADICAL SNAKE)
	"\u2E93": "\u5E7A", // ⺓ → 幺 (CJK RADICAL THREAD)
	"\u2E94": "\u5F51", // ⺔ → 彑 (CJK RADICAL SNOUT ONE)
	"\u2E95": "\u5F50", // ⺕ → 彐 (CJK RADICAL SNOUT TWO)
	"\u2E96": "\u5FC4", // ⺖ → 忄 (CJK RADICAL HEART ONE)
	"\u2E97": "\u5FC3", // ⺗ → 心 (CJK RADICAL HEART TWO)
	"\u2E98": "\u624C", // ⺘ → 扌 (CJK RADICAL HAND)
	"\u2E99": "\u6535", // ⺙ → 攵 (CJK RADICAL RAP)
	"\u2E9B": "\u65E1", // ⺛ → 旡 (CJK RADICAL CHOKE)
	"\u2E9C": "\u65E5", // ⺜ → 日 (CJK RADICAL SUN)
	"\u2E9D": "\u6708", // ⺝ → 月 (CJK RADICAL MOON)
	"\u2E9E": "\u6B7A", // ⺞ → 歺 (CJK RADICAL DEATH)
	"\u2E9F": "\u6BCD", // ⺟ → 母 (CJK RADICAL MOTHER)
	"\u2EA0": "\u6C11", // ⺠ → 民 (CJK RADICAL CIVILIAN)
	"\u2EA1": "\u6C35", // ⺡ → 氵 (CJK RADICAL WATER ONE)
	"\u2EA2": "\u6C3A", // ⺢ → 氺 (CJK RADICAL WATER TWO)
	"\u2EA3": "\u706C", // ⺣ → 灬 (CJK RADICAL FIRE)
	"\u2EA4": "\u722B", // ⺤ → 爫 (CJK RADICAL PAW ONE)
	"\u2EA5": "\u722B", // ⺥ → 爫 (CJK RADICAL PAW TWO)
	"\u2EA6": "\u4E2C", // ⺦ → 丬 (CJK RADICAL SIMPLIFIED HALF TREE TRUNK)
	"\u2EA7": "\u725B", // ⺧ → 牛 (CJK RADICAL COW)
	"\u2EA8": "\u72AD", // ⺨ → 犭 (CJK RADICAL DOG)
	"\u2EA9": "\u738B", // ⺩ → 王 (CJK RADICAL JADE)
	"\u2EAA": "\u758B", // ⺪ → 疋 (CJK RADICAL BOLT OF CLOTH)
	"\u2EAB": "\u76EE", // ⺫ → 目 (CJK RADICAL EYE)
	"\u2EAC": "\u793A", // ⺬ → 示 (CJK RADICAL SPIRIT ONE)
	"\u2EAD": "\u793B", // ⺭ → 礻 (CJK RADICAL SPIRIT TWO)
	"\u2EAE": "\u7AF9", // ⺮ → 竹 (CJK RADICAL BAMBOO)
	"\u2EAF": "\u7CF9", // ⺯ → 糹 (CJK RADICAL SILK)
	"\u2EB0": "\u7E9F", // ⺰ → 纟 (CJK RADICAL C-SIMPLIFIED SILK)
	"\u2EB1": "\u7F53", // ⺱ → 罓 (CJK RADICAL NET ONE)
	"\u2EB2": "\u7F52", // ⺲ → 罒 (CJK RADICAL NET TWO)
	"\u2EB3": "\u7F51", // ⺳ → 网 (CJK RADICAL NET THREE)
	"\u2EB4": "\u7F51", // ⺴ → 网 (CJK RADICAL NET FOUR)
	"\u2EB5": "\u7F51", // ⺵ → 网 (CJK RADICAL MESH)
	"\u2EB6": "\u7F8A", // ⺶ → 羊 (CJK RADICAL SHEEP)
	"\u2EB7": "\u7F8A", // ⺷ → 羊 (CJK RADICAL RAM)
	"\u2EB8": "\u7F8B", // ⺸ → 羋 (CJK RADICAL EWE)
	"\u2EB9": "\u8002", // ⺹ → 耂 (CJK RADICAL OLD)
	"\u2EBA": "\u8080", // ⺺ → 肀 (CJK RADICAL BRUSH ONE)
	"\u2EBB": "\u807F", // ⺻ → 聿 (CJK RADICAL BRUSH TWO)
	"\u2EBC": "\u8089", // ⺼ → 肉 (CJK RADICAL MEAT)
	"\u2EBD": "\u81FC", // ⺽ → 臼 (CJK RADICAL MORTAR)
	"\u2EBE": "\u8279", // ⺾ → 艹 (CJK RADICAL GRASS ONE)
	"\u2EBF": "\u8279", // ⺿ → 艹 (CJK RADICAL GRASS TWO)
	"\u2EC0": "\u8279", // ⻀ → 艹 (CJK RADICAL GRASS THREE)
	"\u2EC1": "\u864E", // ⻁ → 虎 (CJK RADICAL TIGER)
	"\u2EC2": "\u8864", // ⻂ → 衤 (CJK RADICAL CLOTHES)
	"\u2EC3": "\u8980", // ⻃ → 覀 (CJK RADICAL WEST ONE)
	"\u2EC4": "\u897F", // ⻄ → 西 (CJK RADICAL WEST TWO)
	"\u2EC5": "\u89C1", // ⻅ → 见 (CJK RADICAL C-SIMPLIFIED SEE)
	"\u2EC6": "\u89D2", // ⻆ → 角 (CJK RADICAL SIMPLIFIED HORN)
	"\u2EC7": "\u89D2", // ⻇ → 角 (CJK RADICAL HORN)
	"\u2EC8": "\u8BA0", // ⻈ → 讠 (CJK RADICAL C-SIMPLIFIED SPEECH)
	"\u2EC9": "\u8D1D", // ⻉ → 贝 (CJK RADICAL C-SIMPLIFIED SHELL)
	"\u2ECA": "\u8DB3", // ⻊ → 足 (CJK RADICAL FOOT)
	"\u2ECB": "\u8F66", // ⻋ → 车 (CJK RADICAL C-SIMPLIFIED CART)
	"\u2ECC": "\u8FB6", // ⻌ → 辶 (CJK RADICAL SIMPLIFIED WALK)
	"\u2ECD": "\u8FB6", // ⻍ → 辶 (CJK RADICAL WALK ONE)
	"\u2ECE": "\u8FB6", // ⻎ → 辶 (CJK RADICAL WALK TWO)
	"\u2ECF": "\u9091", // ⻏ → 邑 (CJK RADICAL CITY)
	"\u2ED0": "\u9485", // ⻐ → 钅 (CJK RADICAL C-SIMPLIFIED GOLD)
	"\u2ED1": "\u9577", // ⻑ → 長 (CJK RADICAL LONG ONE)
	"\u2ED2": "\u9578", // ⻒ → 镸 (CJK RADICAL LONG TWO)
	"\u2ED3": "\u957F", // ⻓ → 长 (CJK RADICAL C-SIMPLIFIED LONG)
	"\u2ED4": "\u95E8", // ⻔ → 门 (CJK RADICAL C-SIMPLIFIED GATE)
	"\u2ED5": "\u961C", // ⻕ → 阜 (CJK RADICAL MOUND ONE)
	"\u2ED6": "\u961D", // ⻖ → 阝 (CJK RADICAL MOUND TWO)
	"\u2ED7": "\u96E8", // ⻗ → 雨 (CJK RADICAL RAIN)
	"\u2ED8": "\u9752", // ⻘ → 青 (CJK RADICAL BLUE)
	"\u2ED9": "\u97E6", // ⻙ → 韦 (CJK RADICAL C-SIMPLIFIED TANNED LEATHER)
	"\u2EDA": "\u9875", // ⻚ → 页 (CJK RADICAL C-SIMPLIFIED LEAF)
	"\u2EDB": "\u98CE", // ⻛ → 风 (CJK RADICAL C-SIMPLIFIED WIND)
	"\u2EDC": "\u98DE", // ⻜ → 飞 (CJK RADICAL C-SIMPLIFIED FLY)
	"\u2EDD": "\u98DF", // ⻝ → 食 (CJK RADICAL EAT ONE)
	"\u2EDE": "\u98DF", // ⻞ → 食 (CJK RADICAL EAT TWO)
	"\u2EDF": "\u98E0", // ⻟ → 飠 (CJK RADICAL EAT THREE)
	"\u2EE0": "\u9963", // ⻠ → 饣 (CJK RADICAL C-SIMPLIFIED EAT)
	"\u2EE1": "\u9996", // ⻡ → 首 (CJK RADICAL HEAD)
	"\u2EE2": "\u9A6C", // ⻢ → 马 (CJK RADICAL C-SIMPLIFIED HORSE)
	"\u2EE3": "\u9AA8", // ⻣ → 骨 (CJK RADICAL BONE)
	"\u2EE4": "\u9B3C", // ⻤ → 鬼 (CJK RADICAL GHOST)
	"\u2EE5": "\u9C7C", // ⻥ → 鱼 (CJK RADICAL C-SIMPLIFIED FISH)
	"\u2EE6": "\u9E1F", // ⻦ → 鸟 (CJK RADICAL C-SIMPLIFIED BIRD)
	"\u2EE7": "\u5364", // ⻧ → 卤 (CJK RADICAL C-SIMPLIFIED SALT)
	"\u2EE8": "\u9EA6", // ⻨ → 麦 (CJK RADICAL SIMPLIFIED WHEAT)
	"\u2EE9": "\u9EC4", // ⻩ → 黄 (CJK RADICAL SIMPLIFIED YELLOW)
	"\u2EEA": "\u9EFE", // ⻪ → 黾 (CJK RADICAL C-SIMPLIFIED FROG)
	"\u2EEB": "\u6589", // ⻫ → 斉 (CJK RADICAL J-SIMPLIFIED EVEN)
	"\u2EEC": "\u9F50", // ⻬ → 齐 (CJK RADICAL C-SIMPLIFIED EVEN)
	"\u2EED": "\u6B6F", // ⻭ → 歯 (CJK RADICAL J-SIMPLIFIED TOOTH)
	"\u2EEE": "\u9F7F", // ⻮ → 齿 (CJK RADICAL C-SIMPLIFIED TOOTH)
	"\u2EEF": "\u7ADC", // ⻯ → 竜 (CJK RADICAL J-SIMPLIFIED DRAGON)
	"\u2EF0": "\u9F99", // ⻰ → 龙 (CJK RADICAL C-SIMPLIFIED DRAGON)
	"\u2EF1": "\u9F9C", // ⻱ → 龜 (CJK RADICAL TURTLE)
	"\u2EF2": "\u4E80", // ⻲ → 亀 (CJK RADICAL J-SIMPLIFIED TURTLE)
	"\u2EF3": "\u9F9F", // ⻳ → 龟 (CJK RADICAL C-SIMPLIFIED TURTLE)
};

import type { Chapter } from "../types";

/** 扫描结果中的一条变体字记录 */
export interface CJKVariantEntry {
	/** 变体字符 */
	variant: string;
	/** 对应的标准汉字 */
	standard: string;
	/** 在文本中出现的次数 */
	count: number;
	/** Unicode 码点 */
	codePoint: string;
	/** 所属区块标识 */
	block: "kangxi" | "cjk-supplement";
}

/**
 * 将文本中的 CJK 变体字/部首字标准化为现代通用汉字
 * 覆盖范围：
 * - 康熙部首 (U+2F00-U+2FDF)
 * - CJK 部首补充 (U+2E80-U+2EFF)
 * - 对已应用 NFKC 标准化的文本同样有效（兼容性字符会被 NFKC 转换，但部首类不会）
 *
 * @param text 原始文本
 * @returns 标准化后的文本
 */
export function normalizeCJKVariants(text: string): string {
	if (!text) return text;

	const result: string[] = [];
	for (const char of text) {
		const codePoint = char.codePointAt(0)!;
		// 只对 U+2E80-U+2FDF 范围内的字符进行查表替换
		if (codePoint >= 0x2E80 && codePoint <= 0x2FDF) {
			const replacement =
				KANGXI_RADICAL_TO_STANDARD[char] ??
				CJK_RADICAL_SUPPLEMENT_TO_STANDARD[char];
			if (replacement) {
				result.push(replacement);
				continue;
			}
		}
		result.push(char);
	}
	return result.join("");
}

/**
 * 扫描文本中的所有 CJK 变体/部首字符，返回统计信息
 */
export function scanCJKVariants(text: string): CJKVariantEntry[] {
	if (!text) return [];

	const countMap = new Map<string, { count: number; mapping: { standard: string; block: "kangxi" | "cjk-supplement" } }>();

	for (const char of text) {
		const codePoint = char.codePointAt(0)!;
		if (codePoint >= 0x2E80 && codePoint <= 0x2FDF) {
			const replacement = KANGXI_RADICAL_TO_STANDARD[char];
			if (replacement) {
				const existing = countMap.get(char);
				if (existing) {
					existing.count++;
				} else {
					countMap.set(char, { count: 1, mapping: { standard: replacement, block: "kangxi" } });
				}
				continue;
			}

			const replacement2 = CJK_RADICAL_SUPPLEMENT_TO_STANDARD[char];
			if (replacement2) {
				const existing = countMap.get(char);
				if (existing) {
					existing.count++;
				} else {
					countMap.set(char, { count: 1, mapping: { standard: replacement2, block: "cjk-supplement" } });
				}
			}
		}
	}

	// 转成数组排序（出现次数降序）
	return Array.from(countMap.entries())
		.map(([variant, data]) => ({
			variant,
			standard: data.mapping.standard,
			count: data.count,
			codePoint: `U+${variant.codePointAt(0)!.toString(16).toUpperCase()}`,
			block: data.mapping.block,
		}))
		.sort((a, b) => b.count - a.count);
}

/**
 * 在小说全文（chapters）中查找所有变体字
 */
export function scanChaptersVariants(chapters: Chapter[]): CJKVariantEntry[] {
	const fullText = chapters.map(ch => ch.content).join("\n");
	return scanCJKVariants(fullText);
}
