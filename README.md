# 小说 AI 排版与查错工具

基于 Tauri 2 + React + TypeScript 的桌面端与移动端小说排版与查错应用。支持导入 TXT 小说文件，通过 AI 大模型自动检测错别字、排版问题和病句，并提供一键采纳修改。同时支持小说角色分析、关系图谱可视化、剧本转换、TTS 情感朗读等丰富功能。

## ✨ 亮点特性

- 🔍 **AI 智能校对** — 基于大模型检测错别字、排版问题和病句，支持段落/章节两种校对模式
- 📖 **纯阅读模式** — 沉浸式阅读体验，支持调节字体、背景、行间距、首行缩进、自定义背景图
- 👥 **角色分析 & 关系图谱** — AI 自动分析整本小说，提取角色人物小传和关系图谱，支持可视化拖拽展示
- 🎬 **剧本转换** — 一键将小说段落转换为剧本格式，支持自定义改编指令
- 🎙️ **TTS 情感朗读** — AI 自动为对话添加情感/音色标注，支持流式边生成边播放
- 📚 **分卷支持** — 自动识别「第X卷」等分卷结构，支持折叠/展开导航
- 🏠 **主页 & 版本检测** — 启动页展示更新日志，自动检测新版本，支持 GitHub 镜像源多平台下载
- 📱 **多端支持** — Windows / macOS / Linux 桌面端 + Android 移动端
- 💾 **本地优先** — 文件存储在本地，数据安全可控
- 🔄 **碎片化处理** — 突破大模型上下文限制，逐段、逐章处理超长文本，适合校对数百万字的网络小说
- 🔎 **全局搜索** — 跨章节搜索小说内容，支持结果定位跳转（Cmd/Ctrl+F）
- 📝 **忽略单词管理** — 支持管理校对时需要跳过的单词（人名、地名、特殊术语）

## 功能特性

### 🏠 主页
- 启动时展示应用主页，介绍核心功能
- 实时获取 GitHub Release 更新日志，支持版本对比与更新提示
- 多平台下载弹窗（macOS / Windows / Linux / Android），支持自动切换多个镜像源加速下载

### 📖 左侧阅读区
- 导入 TXT 小说文件，自动按 `第X章` 标题分割章节
- **分卷识别**：自动识别 `第X卷`、`Vol.X`、`Volume X` 等分卷格式，章节按卷分组展示
- **分卷折叠导航**：点击卷名可展开/折叠该卷下的章节列表，无分卷时直接平铺展示
- 章节导航栏：上一章/下一章快捷切换，章节列表快速跳转
- 双击编辑：双击任意段落直接修改原文
- 段落高亮：校对结果中的问题段落自动高亮显示
- 一键采纳：点击修改建议直接替换原文，配流畅动画反馈
- **阅读区-校对区联动**：点击阅读区段落时，校对区自动高亮对应行，反之亦然
- **阅读进度记忆**：自动记录阅读进度，支持进度条显示
- **隐藏已校对章节**：一键隐藏所有已完成的章节，聚焦未校对内容

### 📖 纯阅读模式
- 一键切换纯阅读模式，隐藏校对功能，沉浸式阅读
- **字体大小调节**：12px – 28px 滑块调节，实时预览
- **行间距调节**：16px – 80px 精细调整
- **首行缩进**：0 – 4 字符可选
- **阅读背景**：白底 / 护眼 / 棕黄 / 薄荷 / 淡蓝 / 薰衣草 / 桃色 / 鼠尾草 / 石板 / 暗黑 10 种主题
- **自定义背景**：支持网络图片 URL 作为阅读背景

### ✏️ 右侧校对区
- **段落模式**：逐段发送给 AI 检测，适合精细校对
- **章节模式**：整章一次性发送，适合快速扫描
- 三类错误检测：错别字 🔤 / 排版 📐 / 病句 📝
- 每个错误显示：原文 → 建议修改，附带位置索引
- 已采纳/未采纳状态标记，支持撤销和跳过
- **起始行选择**：从指定行开始校对，灵活控制检测范围
- **取消检测**：支持随时中断 AI 请求，段落状态立即重置
- **忽略单词管理**：可添加人名、地名等特殊术语，避免误报

### 🔎 全局搜索
- 跨章节搜索当前小说全部内容（Cmd/Ctrl+F 快速唤起）
- 搜索结果高亮显示，支持 prev/next 导航
- 点击搜索结果自动跳转到对应章节和段落

### 👤 角色管理 & 关系图谱

**角色检测**
- **高频词汇检测**：分析文本中高频出现的词汇，快速发现潜在角色名
- **角色别名识别**：自动识别角色的昵称、尊称等别名（如「张哥」「李姑娘」「王掌门」等）
- **AI 智能分析**：调用大模型深度分析整本小说，提取角色人物小传和完整关系图谱
- 支持超大文本（1M+ tokens）的分批次处理

**角色设置**
- 管理角色信息：名称、别名、性别、角色类型（男主、女主、反派、男配、女配、导师等）
- 自定义角色排序，支持拖拽排序
- 角色忽略名单管理：将非角色词汇加入忽略列表，提高检测准确率

**关系图谱**
- 可视化展示角色之间的关系网络
- 支持多种关系类型：夫妻、父子、恋人、同学、朋友、竞争对手、师徒等
- **聚焦模式**：点击角色筛选下拉框，聚焦特定角色的关系网络，视图自动缩放
- 节点位置持久化：拖拽调整节点位置后自动保存

**导入/导出**
- 支持角色数据完整导入/导出，包含角色信息、关系数据、排序顺序、忽略名单等

### 🎬 剧本转换
- 循环任务模式：逐段将小说内容转换为剧本格式
- 自定义改编指令：输入你想要的改编风格和要求
- 支持场景、角色对话、动作描述、内心独白等剧本元素
- 导出为 TXT 剧本文件

### 🎙️ TTS 情感朗读
- **AI 情感/音色标注**：自动为对话添加情感（开心、悲伤、愤怒等）和音色标签，提升 TTS 表现力
- **流式播放**：支持边生成边播放，音频队列机制实现平滑的连续播放体验
- **段落跳转**：支持上一段/下一段跳转，切换章节时自动重置段落索引
- **播放控制**：支持播放中断和恢复
- **情感朗读模式**：在阅读区点击任意段落开始朗读，实时同步朗读状态

### ⚙️ AI 配置
- 支持 OpenAI 兼容接口（OpenAI、DeepSeek、通义千问、Ollama、SiliconFlow、Mimo 等）
- 可配置：API Base URL、API Key、模型名称、自定义请求头
- API Key 支持显示/隐藏切换
- 配置持久化保存在本地

**自定义 Prompt 配置**
- 支持自定义系统提示词，覆盖以下场景：
  - **校对 Prompt**（段落级别 / 章节级别）
  - **剧本转换 Prompt**
  - **剧本 TTS 情感增强 Prompt**
  - **小说 TTS 情感增强 Prompt**
  - **阅读模式 TTS 增强 Prompt**
- 每个 Prompt 支持一键复制、一键重置为默认值

### 🗑️ 删除确认
- 删除小说前弹出二次确认弹窗，防止误操作导致数据丢失

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2（Rust 后端） |
| 前端 | React 19 + TypeScript |
| 构建 | Vite 8 |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS 4 + CSS Variables |
| 图标 | Lucide React |

## 项目结构

```
novel-proofreader/
├── src/                              # React 前端
│   ├── components/
│   │   ├── App.tsx                   # 主布局（左右三栏 + 移动端 Tab）
│   │   ├── HomePage.tsx              # 主页（更新日志、版本检测、多平台下载）
│   │   ├── ReaderPanel.tsx           # 左侧阅读区
│   │   ├── ChapterNav.tsx            # 章节导航栏（支持分卷折叠）
│   │   ├── ProofreadPanel.tsx        # 右侧校对区
│   │   ├── ProofreadQueuePanel.tsx   # 校对任务队列
│   │   ├── TaskPanel.tsx             # 剧本转换面板
│   │   ├── ConfigModal.tsx           # AI 配置弹窗（含自定义 Prompt）
│   │   ├── CharacterSettings.tsx     # 角色管理 & AI 角色分析
│   │   ├── RelationshipGraph.tsx     # 角色关系图可视化
│   │   ├── GlobalSearch.tsx          # 全局搜索
│   │   ├── NovelList.tsx             # 小说列表
│   │   ├── IgnoredWordsManager.tsx   # 忽略单词管理
│   │   ├── ErrorBoundary.tsx         # 全局错误边界
│   │   ├── EmptyState.tsx            # 空状态占位
│   │   ├── Toast.tsx                 # Toast 消息提示组件
│   │   ├── Select.tsx                # 自定义下拉选择组件
│   │   └── Icons.tsx                 # Lucide 图标封装
│   ├── hooks/
│   │   ├── useFileImport.ts          # 文件导入
│   │   ├── useAICheck.ts             # AI 校对逻辑
│   │   ├── useScriptTask.ts          # 剧本转换逻辑
│   │   ├── useMobile.ts              # 移动端状态管理
│   │   └── useSwipeGesture.ts        # 移动端滑动手势
│   ├── stores/
│   │   ├── appStore.ts               # 全局状态（小说、章节、角色、关系图）
│   │   ├── configStore.ts            # AI / TTS / Prompt 配置状态
│   │   └── proofreadStore.ts         # 校对结果状态
│   ├── types/
│   │   └── index.ts                  # TypeScript 类型定义
│   ├── utils/
│   │   ├── chapterSplit.ts           # 章节分割算法（支持分卷）
│   │   ├── aiClient.ts               # AI API 客户端 & Prompt 模板
│   │   ├── fileExport.ts             # 文件导出 & 角色检测工具
│   │   ├── formatters.tsx            # 格式化工具
│   │   ├── ttsService.ts             # TTS 语音合成 & 音频队列
│   │   ├── githubApi.ts              # GitHub Release API & 镜像源下载
│   │   ├── logger.ts                 # 可开关的日志系统
│   │   ├── scrollUtils.ts            # 滚动工具
│   │   ├── mobile.ts                 # 移动端判断函数
│   │   ├── decodeText.ts             # 文本编码检测
│   │   └── urlParams.ts              # URL 参数解析
│   ├── App.css                       # 全局样式（CSS Variables + 组件样式）
│   ├── main.tsx                      # 入口文件
│   └── vite-env.d.ts                 # Vite 类型声明
├── src-tauri/                        # Tauri Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── icons/                        # 各平台应用图标
│   └── src/lib.rs
├── public/icons/                     # Web 图标
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
pnpm tauri build              # 桌面端
pnpm tauri android build      # Android 端
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 使用流程

1. **启动应用** → 进入主页，可查看更新日志或直接进入应用
2. **导入小说** → 点击左上角「导入 TXT 文件」选择小说，自动识别章节和分卷
3. **配置 AI** → 点击右上角 ⚡ 图标，填入 API Base URL、Key 和模型名，亦可自定义 Prompt
4. **校对** → 选择段落/章节模式，点击「开始校对」，问题段落自动高亮
5. **修改** → 在右侧查看错误列表，点击「采纳修改」应用到原文
6. **角色分析** → 进入角色设置，使用 AI 自动分析整本小说的人物和关系
7. **剧本转换** → 切换到「剧本转换」标签，输入改编指令，点击「开始转换」
8. **TTS 朗读** → 在剧本或阅读模式中，开启 TTS 情感朗读，享受 AI 配音

## AI 接口兼容性

本工具使用 OpenAI Chat Completions API 格式，兼容：

- OpenAI（GPT-4o / GPT-4o-mini）
- DeepSeek（DeepSeek-V4 / DeepSeek-R1）
- 通义千问（Qwen-Max / Qwen-Plus）
- Ollama（本地模型）
- SiliconFlow、Mimo 等
- 任何 OpenAI 兼容接口

## 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 获取详细的版本更新记录。
