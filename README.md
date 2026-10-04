# 小说 AI 排版与查错工具

基于 Tauri 2 + React + TypeScript 的桌面端与移动端小说排版与查错应用。支持导入 TXT / EPUB 小说文件，通过云端 AI、本地服务（Ollama / LM Studio / vLLM）或内置模型（Rust 原生 llama.cpp 推理）自动检测错别字、排版问题和病句，并提供一键采纳修改。同时支持小说角色分析、关系图谱可视化、剧本转换、TTS 情感朗读等丰富功能。

## ✨ 亮点特性

- 🔍 **AI 智能校对** — 基于大模型检测错别字、排版问题和病句，支持段落/章节两种校对模式
- 🤖 **本地大模型集成** — 支持三种推理来源：云端 API、本地外部服务（Ollama / LM Studio / vLLM）、内置模型（Rust 原生 llama.cpp 推理）
- 🧠 **内置中文纠错模型** — 预置 `chinese-text-correction-1.5b`（Q4_K_M 量化，约 1.1 GB），无网也能运行校对，支持导入自定义 `.gguf` 模型
- 📖 **纯阅读模式** — 沉浸式阅读体验，支持调节字体、背景、行间距、首行缩进、自定义背景图
- 👥 **角色分析 & 关系图谱** — AI 自动分析整本小说，提取角色人物小传和关系图谱，支持可视化拖拽展示
- 🎭 **AI 角色扮演** — 与小说角色沉浸式对话，自动注入角色设定、人际关系、世界观与剧情位置，支持多会话管理
- 🎬 **剧本转换** — 一键将小说段落转换为剧本格式，支持自定义改编指令
- 🎙️ **TTS 情感朗读** — AI 自动为对话添加情感/音色标注，支持流式边生成边播放，含角色音色设计
- 📚 **分卷支持** — 自动识别「第X卷」等分卷结构，支持折叠/展开导航
- 🏠 **主页 & 版本检测** — 启动页展示更新日志，自动检测新版本，支持 GitHub 镜像源多平台下载
- 📱 **多端支持** — Windows / macOS / Linux 桌面端 + Android 移动端
- 💾 **本地优先** — 文件存储在本地，数据安全可控
- 🔄 **碎片化处理** — 突破大模型上下文限制，逐段、逐章处理超长文本，适合校对数百万字的网络小说
- 🔎 **全局搜索** — 跨章节搜索小说内容，支持结果定位跳转（Cmd/Ctrl+F）
- 📝 **自定义词典** — 支持忽略词（跳过误报）和替换词（统一术语）两类词典，支持导入导出与全文批量替换
- 🎭 **角色音色设计** — AI 根据角色小传自动生成音色描述（含地域/方言特征），用于 TTS 情感朗读
- 🧪 **AI 连接测试** — 支持自定义测试文本，实时验证 API 连通性与响应速度
- 📊 **详细日志系统** — 为小说管理关键操作添加详细日志记录，便于问题排查和流程追踪
- 🚫 **敏感词替换** — TTS 请求前自动执行文本替换，规避敏感词导致的语音合成失败问题
- 📊 **API 使用统计** — 堆叠柱状图展示近七天 Token 用量，支持鼠标悬浮查看详细数据（输入/输出拆分）
- 🗂️ **数据管理** — 独立的「数据管理」Tab，支持单独处理每本小说的关联数据（角色、关系、世界观），保留清除所有数据功能
- 🔄 **重新断章** — 章节列表头部一键重新识别章节标题并分割小说，解决特殊格式章节识别问题
- 🚀 **首次启动引导** — 新用户首次打开自动弹出三选一快速上手：配置云端 API / 连接 Ollama / 下载内置模型

## 功能特性

### 🏠 主页
- 启动时展示应用主页，介绍核心功能
- 实时获取 GitHub Release 更新日志，支持版本对比与更新提示
- 多平台下载弹窗（macOS / Windows / Linux / Android），支持自动切换多个镜像源加速下载

### 📖 左侧阅读区
- 导入 TXT / EPUB 小说文件，自动按 `第X章` 标题分割章节（EPUB 按 spine 顺序解析章节）
- 支持将当前小说导出为 EPUB 电子书（含目录导航）
- **分卷识别**：自动识别 `第X卷`、`Vol.X`、`Volume X` 等分卷格式，章节按卷分组展示
- **分卷折叠导航**：点击卷名可展开/折叠该卷下的章节列表，无分卷时直接平铺展示
- 章节导航栏：上一章/下一章快捷切换，章节列表快速跳转
- 双击编辑：双击任意段落直接修改原文
- 段落高亮：校对结果中的问题段落自动高亮显示
- 一键采纳：点击修改建议直接替换原文，配流畅动画反馈
- **阅读区-校对区联动**：点击阅读区段落时，校对区自动高亮对应行，反之亦然
- **阅读进度记忆**：自动记录阅读进度，支持进度条显示
- **隐藏已校对章节**：一键隐藏所有已完成的章节，聚焦未校对内容
- **重新断章**：章节列表头部一键重新识别章节标题并分割小说，解决特殊格式章节识别问题，断章过程显示加载状态，完成后 Toast 提示章节总数

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
- **断点续校**：校对任务中断后自动保存进度，恢复后从断点继续，避免重复消耗 Token
- **批量操作**：支持一键采纳当前章节全部建议、跳过全部等批量操作
- **自定义词典**：忽略词（人名、地名等特殊术语，避免误报）和替换词（全文统一替换，如主角改名）两类词典，支持导入导出与全文批量应用

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
- 管理角色信息：名称、别名、性别、角色类型（男主、女主、反派、男配、女配、导师、旁白等）
- 自定义角色排序，支持拖拽排序
- 角色忽略名单管理：将非角色词汇加入忽略列表，提高检测准确率
- **角色重新分析**：支持更新角色信息，重新分析角色小传

**关系图谱**
- 可视化展示角色之间的关系网络
- 支持多种关系类型：夫妻、父子、母女、恋人、同学、朋友、竞争对手、师徒、敌人、同事、兄妹、姐弟等
- **聚焦模式**：点击角色筛选下拉框，聚焦特定角色的关系网络，视图自动缩放
- 节点位置持久化：拖拽调整节点位置后自动保存

**导入/导出**
- 支持角色数据完整导入/导出，包含角色信息、关系数据、排序顺序、忽略名单等

### 🎭 AI 角色扮演
- **沉浸式对话**：与小说中的任意角色进行对话，角色言行严格贴合原著设定
- **智能上下文**：自动注入角色人物小传、人际关系、世界观设定与当前剧情位置，让扮演更加真实
- **双重视角**：支持以局外人（旁观者）身份对话，或扮演小说中另一个角色与其互动
- **多会话管理**：支持创建多个会话、切换/删除会话，会话与消息按小说持久化保存
- **流式生成**：AI 回复流式输出，可随时停止生成、重新生成
- **入口便捷**：桌面端顶部工具栏与移动端底部 Tab 均可一键进入角色扮演

### 🎬 剧本转换
- 循环任务模式：逐段将小说内容转换为剧本格式
- 自定义改编指令：输入你想要的改编风格和要求
- 支持场景、角色对话、动作描述、内心独白等剧本元素
- 导出为 TXT 剧本文件

### 🎙️ TTS 情感朗读
- **AI 情感/音色标注**：自动为对话添加情感（开心、悲伤、愤怒等）和音色标签，提升 TTS 表现力
- **音色设计模型支持**：支持自定义音色设计，优化语音差异化体验
- **角色音色设计**：AI 根据角色人物小传自动生成音色设计描述，包含地域特征、方言特征等信息
- **流式播放**：支持边生成边播放，音频队列机制实现平滑的连续播放体验
- **段落跳转**：支持上一段/下一段跳转，切换章节时自动重置段落索引
- **播放控制**：支持播放中断和恢复
- **情感朗读模式**：在阅读区点击任意段落开始朗读，实时同步朗读状态
- **敏感词替换**：TTS 请求前自动执行文本替换，规避敏感词导致的语音合成失败问题

### 🚫 敏感词替换系统
- 支持管理敏感词替换规则，规避 TTS 大模型敏感词拒绝生成的问题
- 敏感词替换弹窗：支持增删改查替换规则
- TTS 请求前自动执行文本替换，确保语音合成顺利完成
- 顶部导航栏添加「敏感词」入口按钮
- 替换规则持久化存储

### ⚙️ AI 模型配置

**三种推理模型来源**（卡片式三选一）

1. **云端 API** — 8 大提供商网格（OpenAI / DeepSeek / 通义千问 / SiliconFlow / Xiaomi Mimo 等），可配置 Base URL、API Key、模型名称、自定义请求头
2. **本地外部服务** — 支持 Ollama / LM Studio / vLLM
   - 服务地址自动规范化：剥离误粘贴的 API 路径后缀（如 `http://localhost:1234/api/v1/chat` → `http://localhost:1234`）
   - 支持 LM Studio API Key 鉴权（"Server → Require API Key"），留空则不携带 Authorization 头
   - 服务检测链：`GET /api/tags`（Ollama）→ `GET /v1/models`（旧版 LM Studio / vLLM）→ `GET /api/v1/models`（新版 LM Studio REST API）
3. **内置模型（Rust 原生 llama.cpp 推理）**
   - 预置 `chinese-text-correction-1.5b`（Q4_K_M 量化，约 1.1 GB），专为中文文本纠错优化
   - 通过 HuggingFace 流式下载，实时进度推送
   - 支持手动导入本地已下载的 `.gguf` 模型，同名冲突自动加 `_1` 后缀
   - 自动扫描模型目录，识别用户导入与预置模型
   - 系统资源检测（内存/磁盘），智能推荐适配模型（≥16GB 推荐 7B，否则 1.5B）
   - 本地模型使用简化版校对 Prompt，降低推理负担

**通用功能**
- **AI 连接测试**：支持自定义测试文本，实时验证 API 连通性与响应速度
- **账户余额查询**：支持查询 DeepSeek / SiliconFlow 等提供商余额
- **AI 高峰提示**：检测到提供商高峰期自动展示提示横幅
- API Key 支持显示/隐藏切换，配置持久化保存在本地
- **本地服务/内置模型来源下，校对并发自动降为 1**（云端 API 不重置用户配置）

**自定义 Prompt 配置**
- 支持自定义系统提示词，覆盖以下场景：
  - **校对 Prompt**（段落级别 / 章节级别 / 本地小模型简化版）
  - **剧本转换 Prompt**
  - **剧本 TTS 情感增强 Prompt**
  - **小说 TTS 情感增强 Prompt**
  - **阅读模式 TTS 增强 Prompt**
  - **AI 续写 Prompt**
  - **AI 章节桥接 Prompt**（在章节之间生成衔接内容）
  - **世界观分析 Prompt**
  - **角色扮演 Prompt**（含多角色扮演）
- 每个 Prompt 支持一键复制、一键重置为默认值

### 🗑️ 删除确认
- 删除小说前弹出二次确认弹窗，防止误操作导致数据丢失

### 📊 API 使用统计
- **堆叠柱状图**：展示近七天 Token 用量，每根柱子由输入 Token（浅蓝）和输出 Token（深蓝）两部分堆叠组成
- **悬浮提示**：鼠标悬停显示详细数据（日期、总量、输入/输出拆分）
- **Y 轴自动适配**：根据数据范围自动计算刻度，支持 K/M 单位转换
- **统计卡片**：总请求数、成功请求、失败请求、Token 总量、输入/输出 Token 统计
- **成功率/失败率进度条**：可视化展示请求成功率
- **按提供商统计**：支持多提供商的用量统计
- **重置统计**：一键重置所有统计数据

### 🗂️ 数据管理
- **小说列表**：展示所有已导入的小说，显示名称、章节数和角色数
- **单小说数据清除**：清除指定小说的角色、关系、世界观等关联数据（保留小说本身）
- **单小说删除**：删除小说及其所有关联数据
- **清除所有数据**：危险操作，清除所有小说和配置数据，需二次确认

### 📋 日志系统
- **操作日志记录**：为小说管理关键操作添加详细日志记录（打开小说、切换章节、替换段落文本等）
- **日志开关**：通过 AI 配置中的开关控制日志输出
- **多类型日志**：支持文件、调试、信息、警告、错误、校对、搜索、TTS、UI 等多种日志类型

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2（Rust 后端） |
| 前端 | React 19 + TypeScript（严格模式） |
| 构建 | Vite 8 |
| 状态管理 | Zustand 5（persist 中间件） |
| 样式 | Tailwind CSS 4 + CSS Variables（Apple Liquid Glass 设计系统） |
| 图标 | Lucide React |
| 本地推理 | llama-cpp-2 0.1（可选 feature，Metal GPU 加速） |
| HTTP 客户端 | reqwest 0.12（rustls-tls，跨平台无 OpenSSL 依赖） |
| 电子书 | fflate（EPUB 解析与生成） |
| 中文处理 | chinese-conv（简繁转换） |
| 测试 | Vitest 4 + Testing Library |
| 工具库 | 安全存储（AES-GCM）、类型守卫、统一错误处理工具 |

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
│   │   ├── ConfigModal.tsx           # 设置弹窗（5 个标签页）
│   │   ├── LocalModelSettings.tsx    # 本地服务 / 内置模型配置面板
│   │   ├── FirstRunGuideModal.tsx    # 首次启动引导（三选一快速上手）
│   │   ├── CharacterSettings.tsx     # 角色管理 & AI 角色分析
│   │   ├── RelationshipGraph.tsx     # 角色关系图可视化
│   │   ├── RoleplayModal.tsx         # AI 角色扮演弹窗
│   │   ├── RoleplayProfileModal.tsx  # 角色小传预览弹窗
│   │   ├── NovelEventModal.tsx       # 小说事件管理弹窗
│   │   ├── AIContinuation.tsx        # AI 续写面板
│   │   ├── ScriptRenderer.tsx        # 剧本渲染器
│   │   ├── GlobalSearch.tsx          # 全局搜索
│   │   ├── NovelList.tsx             # 小说列表
│   │   ├── IgnoredWordsManager.tsx   # 词典管理（忽略词 + 替换词）
│   │   ├── WordReplacementModal.tsx  # 敏感词替换弹窗
│   │   ├── DiffModal.tsx             # 双文本对比弹窗
│   │   ├── CJKVariantsModal.tsx      # 变体字/半角全角检查弹窗
│   │   ├── PeakHourBanner.tsx        # AI 高峰时段提示横幅
│   │   ├── Modal.tsx                 # 通用弹窗
│   │   ├── ErrorBoundary.tsx         # 全局错误边界
│   │   ├── EmptyState.tsx            # 空状态占位
│   │   ├── Toast.tsx                 # Toast 消息提示组件
│   │   ├── Select.tsx                # 自定义下拉选择组件
│   │   ├── AutoResizeTextarea.tsx    # 自适应文本框
│   │   └── Icons.tsx                 # Lucide 图标统一封装
│   │   └── config/                   # 设置弹窗子面板
│   │       ├── AITestSection.tsx     # AI 连接测试
│   │       ├── BalanceSection.tsx    # 账户余额查询
│   │       ├── APIUsageSection.tsx   # API 用量统计
│   │       ├── DataManagementSection.tsx  # 数据管理
│   │       ├── PromptSettingsSection.tsx   # 自定义 Prompt 配置
│   │       ├── ProofreadSettingsSection.tsx # 校对设置
│   │       ├── TTSConfigSection.tsx  # TTS 语音配置
│   │       └── ConfirmModal.tsx      # 确认弹窗
│   ├── hooks/
│   │   ├── useAICheck.ts             # AI 校对逻辑（断点续校、批量操作）
│   │   ├── useScriptTask.ts          # 剧本转换逻辑
│   │   ├── useTTS.ts                 # TTS 情感朗读
│   │   ├── useChapterTitleSuggestion.ts  # AI 章节名推荐
│   │   ├── useReadingProgress.ts     # 阅读进度管理
│   │   ├── useSearch.ts              # 全局搜索逻辑
│   │   ├── useElapsedTime.ts         # 耗时统计
│   │   ├── useAutoResizeTextarea.ts  # 自适应文本框
│   │   ├── useMobile.ts              # 移动端状态管理
│   │   └── useSwipeGesture.ts        # 移动端滑动手势
│   ├── stores/
│   │   ├── appStore.ts               # 全局状态聚合入口
│   │   ├── novelStore.ts             # 小说/章节状态
│   │   ├── characterStore.ts         # 角色状态
│   │   ├── roleplayStore.ts          # 角色扮演会话状态
│   │   ├── configStore.ts            # AI / TTS / Prompt 配置状态
│   │   ├── aiConfigStore.ts          # AI 连接配置
│   │   ├── localModelStore.ts        # 本地模型状态（服务检测、模型列表、下载）
│   │   ├── uiStore.ts                # UI 状态（弹窗等）
│   │   ├── proofreadStore.ts         # 校对结果状态
│   │   ├── proofreadMetaStore.ts     # 校对元数据 + 词典（忽略词/替换词）
│   │   ├── appMetaStore.ts           # 应用元数据
│   │   └── wordReplacementStore.ts   # 敏感词替换状态
│   ├── types/
│   │   └── index.ts                  # TypeScript 类型定义
│   ├── utils/
│   │   ├── aiClient.ts               # AI API 客户端 & Prompt 模板（含 sendChatCompletionAuto 路由）
│   │   ├── chapterSplit.ts           # 章节分割算法（支持分卷）
│   │   ├── epub.ts                   # EPUB 解析与生成
│   │   ├── fileExport.ts             # 文件导出 & 角色检测工具
│   │   ├── ttsService.ts             # TTS 语音合成 & 音频队列
│   │   ├── githubApi.ts              # GitHub Release API & 镜像源下载
│   │   ├── logger.ts                 # 可开关的日志系统
│   │   ├── secureStorage.ts          # 安全存储工具（AES-GCM）
│   │   ├── novelStorage.ts           # IndexedDB 大文本存储
│   │   ├── concurrent.ts             # 并发工具（信号量/队列）
│   │   ├── textDiff.ts               # 文本差异对比
│   │   ├── textSearch.ts             # 文本搜索
│   │   ├── chapterMatch.ts           # 章节匹配
│   │   ├── decodeText.ts             # 文本编码检测
│   │   ├── normalizeCJK.ts           # 变体字/半角全角处理
│   │   ├── traditionalToSimplified.ts # 简繁转换
│   │   ├── punctuationCheck.ts       # 标点符号检查
│   │   ├── scriptMarkdown.ts         # 剧本 Markdown 解析
│   │   ├── formatters.tsx            # 格式化工具
│   │   ├── errorHandler.ts           # 错误处理工具
│   │   ├── scrollUtils.ts            # 滚动工具
│   │   ├── mobile.ts                 # 移动端判断函数
│   │   ├── notifications.ts          # 系统通知
│   │   ├── androidService.ts         # Android 服务
│   │   ├── typeGuards.ts             # 类型守卫
│   │   ├── characterRoles.ts         # 角色类型中文映射
│   │   ├── id.ts                     # ID 生成
│   │   └── urlParams.ts              # URL 参数解析
│   ├── App.css                       # 全局样式（CSS Variables + 组件样式）
│   ├── App.tsx                       # Tauri 入口组件（路由/全局布局）
│   ├── main.tsx                      # 应用入口文件
│   └── vite-env.d.ts                 # Vite 类型声明
├── src-tauri/                        # Tauri Rust 后端
│   ├── Cargo.toml                    # 依赖配置（reqwest 使用 rustls-tls）
│   ├── tauri.conf.json
│   ├── icons/                        # 各平台应用图标
│   ├── capabilities/                 # 权限配置
│   └── src/
│       ├── lib.rs                    # Tauri 插件注册与应用入口
│       ├── commands.rs               # Tauri 命令（TTS、校对、LLM 等）
│       ├── main.rs                   # 桌面端入口
│       └── llm/                      # 本地 LLM 推理模块
│           ├── mod.rs                # 模块入口
│           ├── engine.rs             # 推理核心（llama-cpp-2 封装）
│           ├── memory.rs             # 系统资源检测（内存/磁盘）
│           └── model_manager.rs      # 模型列表 / 下载 / 导入 / 扫描
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
- pnpm（推荐）
- Rust >= 1.77
- Tauri 2 系统依赖（参考 [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)）
- **本地 LLM 推理（可选）**：`cmake` + C++ 工具链（编译 llama.cpp 所需）
- **Android 构建（可选）**：Android SDK + NDK + `cargo-ndk`

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
pnpm tauri build              # 桌面端（默认不含本地 LLM 推理）
pnpm tauri build -- --features local-llm   # 启用内置模型推理（需 cmake）
pnpm tauri android build      # Android 端
```

构建产物位于 `src-tauri/target/release/bundle/`。

### 测试

```bash
pnpm test          # 前端单元测试（Vitest）
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 单元测试
```

### 本地 LLM 推理说明

- `local-llm` feature 默认关闭（保证 Android / CI 兼容），启用后会编译 llama.cpp，首次耗时较长
- macOS 启用 Metal GPU 加速；Linux / Windows 自动回退 CPU 推理
- 内置模型运行时通过 Tauri Command 调用，无需额外进程
- HTTP 客户端使用 `rustls-tls`（纯 Rust TLS 实现），避免 Android 交叉编译时找不到 OpenSSL

### 发布签名与可复现打包

> 完整说明见 [`docs/RELEASE_SIGNING.md`](docs/RELEASE_SIGNING.md)；
> 各平台 keystore / 证书 / 密钥的**生产步骤与 GitHub Secrets 生成引导**见该文档第 4 节。

本项目区分两种「配置」：应用内 AI 配置（API Key 等，用户数据），以及**打包发布配置**
（keystore / 代码签名证书 / updater 密钥）。后者由 `signing.config.json` 统一定义。

```bash
# 1. 交互式配置引导：生成 Android keystore、配置 macOS/Windows 签名、生成 updater 密钥
pnpm run setup:signing

# 2. 自检（版本号跨文件一致性、keystore、Gradle 补丁、updater 公钥）
pnpm run signing:check

# 3. 查看还缺哪些 Secret，以及每个缺失项的「去哪拿 + 写入命令」
pnpm run secrets:status

# 4. 把签名材料写入 GitHub Secrets（需要 gh CLI 已登录）
gh secret set -f .signing/github-secrets.env   # 向导已汇总成 dotenv
bash scripts/ci/push-secrets.sh                # 等价的兜底脚本

# 5. 可复现构建 + 生成产物清单
pnpm run build:release -- --android --android-arch=arm64

# 6. 跨机器/跨次比对产物是否逐字节一致
pnpm run verify:reproducible -- --expected=a.json --actual=b.json
```

核心约定：

- **同一 `configKey`（`signing.config.json` 的内容指纹）+ 同一套签名 key + 同一工具链 ⇒ 产物逐字节一致。**
- 产物不包含任何私钥；签名材料只存在于 `.signing/`（已 gitignore）与 CI Secrets 中。
- 每次构建都会生成 `release-manifest-*.json`，记录每个产物的 sha256、签名证书指纹与工具链指纹。
- Android APK 在打包后会被归一化时间戳并用同一 keystore 重签名，因此可做到**逐字节一致**
  （已由 `Verify Reproducible Build` workflow 在两台不同 runner 上实证）。
- 工具链由 `rust-toolchain.toml`、`pnpm-lock.yaml` 与 `package.json` 固定；`tauri CLI`
  使用 `pnpm tauri`（lockfile 版本）而非 `cargo install` 的最新版。

## 使用流程

1. **启动应用** → 首次启动弹出三选一引导（云端 API / 本地 Ollama / 下载内置模型），可直接跳过
2. **导入小说** → 点击左上角「导入」选择 TXT / EPUB 文件，自动识别章节和分卷
3. **配置 AI** → 打开设置 → 「AI 模型」标签，三选一模型来源：
   - 云端 API：选择提供商（OpenAI / DeepSeek 等），填入 API Key
   - 本地服务：填入 Ollama / LM Studio 地址（自动规范化路径后缀）
   - 内置模型：下载预置 1.5B 纠错模型，或导入自定义 `.gguf`
4. **校对** → 选择段落/章节模式，点击「开始校对」，问题段落自动高亮；中断后可断点续校
5. **修改** → 在右侧查看错误列表，点击「采纳修改」应用到原文，支持批量采纳
6. **词典** → 管理忽略词（避免误报）与替换词（统一术语），支持全文批量替换
7. **角色分析** → 进入角色设置，使用 AI 自动分析整本小说的人物和关系
8. **角色扮演** → 点击顶部「角色扮演」按钮，选择角色与小说中的角色沉浸式对话
9. **剧本转换** → 切换到「剧本转换」标签，输入改编指令，点击「开始转换」
10. **TTS 朗读** → 在剧本或阅读模式中，开启 TTS 情感朗读，享受 AI 配音
11. **导出** → 校对完成后导出为 TXT 或 EPUB 电子书

## AI 接口兼容性

### 云端 API（OpenAI Chat Completions 兼容）

- OpenAI（GPT-4o / GPT-4o-mini）
- DeepSeek（DeepSeek-V4 / DeepSeek-R1）
- 通义千问（Qwen-Max / Qwen-Plus）
- SiliconFlow
- Xiaomi Mimo
- 任何 OpenAI 兼容接口

### 本地外部服务

- **Ollama** — 自动检测 `GET /api/tags`
- **LM Studio** — 兼容旧版 `GET /v1/models` 与新版 `GET /api/v1/models` REST API，支持可选 API Key 鉴权
- **vLLM** — 通过 `GET /v1/models` 检测

### 内置模型（Rust 原生推理）

- 基于 llama-cpp-2 的 GGUF 模型加载
- 预置 `QuantFactory/chinese-text-correction-1.5b`（Q4_K_M 量化）
- 支持任意符合 GGUF 格式的本地模型导入

## 致谢 (Credits)

### 开发致谢

本项目通过 TRAE AI 编程工具开发，主要使用以下大模型进行代码生成、调试和优化（排名不分先后）：

- **TRAE** — AI 编程助手，基于 Claude 系列模型提供代码生成、重构、调试等全方位开发支持
- **DeepSeek** — DeepSeek 系列模型用于复杂逻辑实现、代码审查与优化
- **Xiaomi MiClaw** — 手机端 AI 编程助手，初始版本由 MiClaw 完成开发

### 功能模型支持

本项目运行时支持的 AI 大模型（排名不分先后）：

- **OpenAI** — GPT-4o / GPT-4o-mini 用于 AI 校对、角色分析、剧本转换等核心功能
- **DeepSeek** — DeepSeek-V4 / DeepSeek-R1 用于校对与文本分析
- **通义千问 (Alibaba Cloud)** — Qwen-Max / Qwen-Plus 用于校对与角色分析
- **SiliconFlow** — 提供多模型聚合 API 服务
- **Xiaomi Mimo** — Mimo TTS 模型用于情感朗读与角色音色设计
- **LM Studio** — 本地模型运行与调试
- **Ollama** — 本地模型便捷部署与测试
- **vLLM** — 高性能推理引擎，为部分 API 网关提供后端支持
- **llama.cpp** — 高性能 GGUF 模型推理引擎，为内置模型提供本地推理能力
- **QuantFactory** — `chinese-text-correction-1.5b` GGUF 量化模型，专为中文文本纠错优化

感谢上述团队与社区提供的优质模型和服务，使本项目得以实现多样化的 AI 功能。

## 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 获取详细的版本更新记录。
