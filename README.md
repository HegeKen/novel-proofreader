# 小说 AI 排版与查错工具

基于 Tauri 2 + React + TypeScript 的桌面端小说排版与查错应用。支持导入 TXT 小说文件，通过 AI 大模型自动检测错别字、排版问题和病句，并提供一键采纳修改。同时支持将小说段落循环转换为剧本格式。

## ✨ 亮点特性

- 🔍 **AI 智能校对** - 基于大模型检测错别字、排版问题和病句
- 📖 **纯阅读模式** - 沉浸式阅读体验，支持调节字体、背景、行间距
- 🎬 **剧本转换** - 一键将小说转换为剧本格式
- 📱 **多端支持** - Windows/macOS/Linux 桌面端 + Android 移动端
- 💾 **本地优先** - 文件存储在本地，数据安全可控
- 🎨 **Liquid Glass 设计** - 优雅的毛玻璃视觉风格
- 🔄 **碎片化处理** - 突破大模型上下文限制，逐段处理超长文本，适合校对数百万字的网络小说
- 🔔 **操作反馈** - Toast 消息提示，提供采纳修改、撤销、跳过等操作的明确反馈
- 📝 **忽略单词管理** - 支持管理校对时需要跳过的单词（如人名、地名、特殊术语）
- 🔍 **章节搜索** - 快速搜索当前章节内容，支持结果定位

## 功能特性

### 📖 左侧阅读区
- 导入 TXT 小说文件，自动按 `第X章` 标题分割章节
- 章节导航栏：上一章/下一章快捷切换，章节列表快速跳转
- 双击编辑：双击任意段落直接修改原文
- 段落高亮：校对结果中的问题段落自动高亮显示
- 一键采纳：点击修改建议直接替换原文
- 采纳动画：采纳修改时的流畅动画反馈
- **阅读区-校对区联动**：点击阅读区段落时，校对区自动高亮对应行，反之亦然

### 📖 纯阅读模式
- 一键切换纯阅读模式，隐藏校对功能，沉浸式阅读
- **字体大小调节**：12px - 28px 滑块调节，实时预览
- **行间距调节**：16px - 80px 精细调整
- **首行缩进**：0 - 4 字符可选
- **阅读背景**：白底/护眼/棕黄/薄荷/淡蓝/薰衣草/桃色/鼠尾草/石板 9种主题
- **自定义背景**：支持上传背景图片

### ✏️ 右侧校对区
- **段落模式**：逐段发送给 AI 检测，适合精细校对
- **章节模式**：整章一次性发送，适合快速扫描
- 三类错误检测：错别字 🔤 / 排版 📐 / 病句 📝
- 每个错误显示：原文 → 建议修改，附带位置索引
- 已采纳/未采纳状态标记，支持撤销和跳过
- **忽略单词管理**：可添加人名、地名等特殊术语，避免误报

### 🔎 搜索功能
- 在阅读区快速搜索当前章节内容
- 搜索结果高亮显示，支持 prev/next 导航
- 点击搜索结果自动跳转到对应段落

### 🎬 剧本转换
- 循环任务模式：逐段将小说内容转换为剧本格式
- 自定义改编指令：输入你想要的改编风格和要求
- 支持场景、角色对话、动作描述、内心独白等剧本元素
- 导出为 TXT 剧本文件

### ⚙️ AI 配置
- 支持 OpenAI 兼容接口（OpenAI、DeepSeek、通义千问、Ollama、SiliconFlow、Mimo 等）
- 可配置：API Base URL、API Key、模型名称
- API Key 支持显示/隐藏切换
- 配置持久化保存在本地

### 🔔 操作反馈
- Toast 消息提示组件，支持成功、错误、警告、信息四种类型
- 采纳修改、撤销、跳过等操作提供明确的成功/失败反馈
- 自动 3 秒后消失

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2（Rust 后端） |
| 前端 | React 19 + TypeScript |
| 构建 | Vite 8 |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS 4 |

## 项目结构

```
novel-proofreader/
├── src/                          # React 前端
│   ├── components/
│   │   ├── App.tsx               # 主布局（左右分栏）
│   │   ├── ReaderPanel.tsx       # 左侧阅读区
│   │   ├── ChapterNav.tsx        # 章节导航栏
│   │   ├── ProofreadPanel.tsx    # 右侧校对区
│   │   ├── TaskPanel.tsx         # 剧本转换面板
│   │   ├── ConfigModal.tsx       # AI 配置弹窗
│   │   ├── Toast.tsx             # Toast 消息提示组件
│   │   ├── Select.tsx            # 自定义选择组件
│   │   ├── Icons.tsx             # Lucide 图标封装
│   │   └── IgnoredWordsModal.tsx # 忽略单词管理弹窗
│   ├── hooks/
│   │   ├── useFileImport.ts      # 文件导入
│   │   ├── useAICheck.ts         # AI 校对逻辑
│   │   ├── useScriptTask.ts      # 剧本转换逻辑
│   │   └── useSwipeGesture.ts    # 移动端滑动手势
│   ├── stores/
│   │   ├── appStore.ts           # 全局状态（文件、章节）
│   │   ├── configStore.ts        # AI 配置状态
│   │   └── proofreadStore.ts     # 校对结果状态
│   ├── types/
│   │   └── index.ts              # TypeScript 类型定义
│   ├── utils/
│   │   ├── chapterSplit.ts       # 章节分割算法
│   │   ├── aiClient.ts           # AI API 客户端
│   │   ├── fileExport.ts         # 文件导出工具
│   │   └── logger.ts             # 日志工具
│   ├── styles/
│   │   └── styles.css            # 全局样式
│   ├── main.tsx                  # 入口
│   └── vite-env.d.ts
├── src-tauri/                    # Tauri Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/lib.rs
├── package.json
├── tsconfig.json
├── vite.config.ts
├── CHANGELOG.md
└── README.md
```

## 开发

### 环境要求

- Node.js >= 18
- Rust >= 1.77
- Tauri 2 系统依赖（参考 [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)）

### 安装依赖

```bash
# 前端依赖
pnpm install

# Rust 依赖（首次需要）
cd src-tauri && cargo build && cd ..
```

### 开发模式

```bash
pnpm tauri dev
```

### 构建发布版

```bash
pnpm tauri build
pnpm tauri android build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 使用流程

1. **启动应用** → 点击左上角「导入文件」选择 TXT 小说
2. **配置 AI** → 点击右上角 ⚙️ 图标，填入 API Base URL、Key 和模型名
3. **校对** → 选择段落/章节模式，点击「开始校对」
4. **修改** → 在右侧查看错误列表，点击「采纳修改」应用到原文
5. **剧本转换** → 切换到「剧本转换」标签，输入改编指令，点击「开始转换」

## AI 接口兼容性

本工具使用 OpenAI Chat Completions API 格式，兼容：

- OpenAI（GPT-4o / GPT-4o-mini）
- DeepSeek（DeepSeek-V4 / DeepSeek-R1）
- 通义千问（Qwen-Max / Qwen-Plus）
- Ollama（本地模型）
- 任何 OpenAI 兼容接口

## 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 获取详细的版本更新记录。

### 最近更新（v0.9.3）

- 🐛 **起始行选择器行号显示修复** - 修复显示行号与实际高亮段落不一致的问题
- 🐛 **阅读区起始行高亮修复** - 修复 line-number start-line 高亮显示不对的问题
- 🐛 **取消检测功能优化** - 点击取消后立即断开大模型请求并更新段落状态
- 📝 **剧本TTS流式播放优化** - 支持边生成边播放，音频队列机制实现平滑连续播放
- 👤 **剧本角色管理增强** - 优化角色音色配置，支持更精细的语音差异化
- ✅ **阅读区-校对区联动高亮** - 点击阅读区段落时，校对区自动高亮对应行，反之亦然
- 📖 **纯阅读模式增强** - 沉浸式阅读体验，支持调节字体、背景、行间距
- 🎬 **剧本转换功能** - 一键将小说转换为剧本格式

## License

MIT
