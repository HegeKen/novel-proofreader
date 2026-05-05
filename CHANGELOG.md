# Changelog

## [0.8.3] - 2026-05-05

### ✨ 新功能

**通知服务模块**
- 新增通知服务模块，用于发送校对进度和完成通知
- 在 ProofreadPanel 中添加进度跟踪和通知发送逻辑

**跳过错误功能**
- 新增跳过错误功能及相关 UI 组件

### 🔧 改进优化

**依赖更新**
- 更新依赖，添加 tauri 通知插件

**样式适配**
- 修改样式适配新功能

**阅读面板编辑模式优化**
- 高亮段落进入编辑模式时字体缩小（13px），提升编辑视野与专注度

---

## [0.8.0] - 2026-05-04

### ✨ 新功能

**移动端章节校对状态标记**
- 新增章节左滑标记为"已校对"功能
- 新增章节右滑取消"已校对"标记
- 章节列表右侧显示校对状态图标（lucide-circle-check-big）
- 新增 useSwipeGesture 自定义 Hook 支持触摸滑动手势检测

**阅读面板互斥逻辑**
- TTS 面板与阅读设置面板互斥，同时只能开启一个
- 点击打开一个面板时自动关闭另一个面板

### 🔧 改进优化

**按钮图标更新**
- 设置按钮（btn-settings）图标更换为 Bolt
- 语音设置按钮（reader-settings-btn）图标更换为 BookAudio
- 阅读设置按钮（reading-settings-toggle）图标更换为 LineStyle
- TTS 按钮（reader-tts-btn）图标更换为 BookHeadphones

**移动端浮动按钮优化**
- reader-floating-actions 按钮改为横排布局
- 按钮形状统一为正圆形（36px × 36px）
- 按钮图标完美居中显示
- 样式与 header-right 按钮保持一致

**面板样式优化**
- reading-settings-panel 添加模糊背景效果（backdrop-filter: blur(20px)）
- TTS 面板与阅读设置面板样式统一
- 移动端面板位置调整至浮动按钮上方（bottom: 180px）

**UI 细节优化**
- 自定义颜色标签颜色跟随深色/亮色模式变更（var(--text-secondary)）
- 移动端点击标题自动切换到小说标签页

---

## [0.7.5] - 2026-05-03

### ✨ 新功能

**使用 lucide-react 统一图标系统**
- 全面替换项目中的所有图标为 lucide-react 图标库
- 新增自定义 Select 组件，使用 lucide-react 封装 select 选项
- 新增 Icons.ts 组件支持多种新图标（plus、file、calendar、clock、close 等）

### 🔧 改进优化

**阅读区按钮布局优化**
- 调整 floating-actions 按钮间距统一为 12px
- TTS 面板和阅读设置面板位置调整至按钮组上方，保持统一间距
- 移动端设置按钮只显示图标，完美居中显示

**Select 组件优化**
- 新增 Select 组件支持 ChevronDown 下拉箭头
- 选中项显示 Check 图标
- 选项文字居中显示
- 支持点击外部关闭
- 玻璃效果与整体风格一致

**校对工具栏优化**
- 桌面端与移动端文字大小统一为 12px
- 按钮间距从 10px 减至 6px
- granularity-select 和 start-line-select 间距从 4px 减至 2px
- 标签和 Select 组件图标文字大小统一

**小说列表 UI 优化**
- novel-item-meta 图标文字并排显示
- 文件大小、导入时间、缓存时间均使用 lucide-react 图标
- novel-item-remove 使用 Icons.close 替换 ×
- btn-import-novel 使用 Icons.plus 替换 +

**UI 细节优化**
- btn-theme-toggle 移动端隐藏文字，只显示图标
- mobile-proofread-toggle 图标文字并排显示
- right-tabs 标签图标文字并排显示
- header-left 图标文字并排显示
- app-title 链接点击可跳转到首页（无参状态）

### 🐛 Bug 修复

**ConfigModal 修复**
- 修复 ConfigModal.tsx 语法错误，补齐缺失的闭合括号
- API Key 输入框 toggle-visibility-btn 统一使用 Icons.eye 和 Icons.eyeOff

**Select 组件修复**
- 修复 Select 组件 width 问题，确保占据完整宽度
- 修复 Select 组件 relative 元素居中显示

---

## [0.7.1] - 2026-05-02

### ✨ 新功能

**阅读模式字体大小调整**
- 在纯阅读模式的设置面板中添加字体大小滑块
- 支持 12px - 28px 范围调节
- 实时预览字体大小变化

### 🔧 改进优化

**代码质量提升**
- 修复 ReaderPanel.tsx 中 `readingTextColor` 变量声明顺序问题
- 移除未使用的 `paragraphSpacing` 变量引用

---

## [0.7.0] - 2026-05-02

### 🔧 改进优化

**移动端界面精简**
- 移除移动端快捷操作栏（mobile-action-bar）
- 调整移动端布局底部 padding，从 120px 缩减至 64px

**剧本改编功能优化**
- 移除"按行"粒度转换选项，仅保留"按段落"和"整章"
- 简化剧本转换流程

### 🐛 Bug 修复

**TypeScript 编译错误修复**
- 修复 fileExport.ts 缺少闭合括号导致的语法错误
- 移除 NovelList.tsx 中未使用的函数和变量

**localStorage 配额问题修复**
- 将 chapters 从持久化存储中移除，避免小说内容过大导致 QuotaExceededError
- 章节内容仅保留在内存中，选择小说时从文件系统重新加载

**Tauri 版本同步**
- 同步 Cargo.toml 与 package.json 的 Tauri 依赖版本至 2.11.0
- 修复 tauri-plugin-fs 构建错误

---

## [0.6.6] - 2026-05-02

### 🐛 Bug 修复

**撤销操作高亮显示修复**
- 修复点击撤销后阅读区恢复的原始文本没有高亮显示的问题
- 移除了 `undo-restore` 阶段的高亮限制，确保撤销内容始终可见
- 为 `undo-restore` 阶段添加红色高亮样式，与撤销前的绿色采纳样式形成对比
- 便于用户直观查看哪些内容被成功撤销恢复

---

## [0.6.5] - 2026-05-01

### 🔧 改进优化

**Android 状态栏适配**
- 使用 CSS `env(safe-area-inset-*)` 变量适配 iOS 和 Android 状态栏
- 更新 index.html 添加 `viewport-fit=cover` 支持边缘到边缘显示
- 添加 `theme-color` 和 Apple 移动端相关 meta 标签
- `.app-header` 添加顶部安全区域 padding
- `.mobile-tab-bar` 添加底部安全区域 padding 和高度
- `.app-body` 移动端布局正确计算安全区域

**Android 文件存储路径优化**
- 配置 Tauri fs 插件使用 `BaseDirectory.Document` 存储路径
- 文件保存到 `Android/data/cn.helilab.proofreader/documents/novels/` 目录
- 用户可通过文件管理器直接访问导出的小说文件
- 更新 capabilities 配置，添加 `$DOCUMENT` 路径访问权限
- 更新 file_paths.xml 扩展 FileProvider 路径配置

**Android 构建配置**
- `minSdkVersion` 设置为 24 (Android 7.0)
- AndroidManifest.xml 配置存储权限

**调试日志增强**
- 添加文件保存操作的详细日志输出
- 便于排查 Android 端文件同步问题

### 🐛 Bug 修复

**采纳修改后错误消失问题**
- 修复 `ProofreadPanel` 中 `useEffect` 依赖数组导致的内容变更后 results 被重置的问题
- 将依赖从 `chapter` 改为 `chapter?.id`，避免章节内容更新时误触发 results 重置

---

## [0.6.1] - 2026-05-01

### 🔧 改进优化

**校对 Prompt 优化**
- 减少对引号、省略号全角/半角混用等次要标点问题的提示
- 优先关注错别字、语法错误、逻辑不通的句子、严重排版问题
- 仅检查重大标点错误（如明显错用导致语义混淆、重复标点、严重空格问题）

**剧本转换 Prompt 优化**
- 明确场景编号规范（【场景 1】、【场景 2】等）
- 角色对话格式优化：角色名单独一行，对话单独一行
- 新增【内心独白】格式，专门处理心理描写
- 强调保持原文完整性，不添加或删减重要内容
- 场景之间空一行，结构更清晰
- 明确禁止输出 Markdown 或代码块

---

## [0.6.0] - 2026-05-01

### ✨ 新功能

**阅读区搜索功能**
- 在非纯阅读模式下显示搜索按钮（📍），点击可搜索当前章节内容
- 搜索结果列表展示匹配内容（高亮显示），点击结果自动跳转到对应段落
- 支持 prev/next 导航按钮切换匹配项
- 修复搜索跳转问题，确保点击结果后正确滚动到目标行

**文件导出保护**
- 导出文件时如果文件名已存在，弹出确认对话框
- 用户可选择「覆盖保存」或「自动生成新文件名」
- 新文件名格式：原名 + 时间戳后缀

### 🔧 改进优化

**移动端按钮样式统一**
- 统一移动端所有圆形按钮尺寸为 36x36px，border-radius 50%
- 统一 btn-export-mobile、btn-save-mobile、btn-theme-toggle、btn-settings 按钮尺寸

**按钮风格统一**
- 统一 btn-export、btn-import、btn-save-original 按钮样式
- 移除冲突样式，统一使用 "Liquid Glass" 按钮风格

### 🐛 Bug 修复

**Android 导出问题**
- 修复安卓端导出文件为空的问题
- 改用 Tauri dialog 和 fs 插件处理文件保存
- 添加 TextEncoder 正确编码文件内容

---

## [0.5.5] - 2026-04-30

### 🔧 改进优化

**移动端 UI 布局优化**
- 移动端导出按钮移至顶部 header-right 区域，方便操作
- proofread-toolbar 修复 sticky 定位问题（添加 `overflow: visible`）
- proofread-toolbar 背景添加毛玻璃效果，与 app-header 保持一致风格
- proofread-toolbar 内部三个元素（检测粒度、起始行、检测按钮）改为单行显示
- 移动端收起/显示校对按钮位置调整，紧靠校对区顶部

**移动端阅读区优化**
- 减小阅读区字体大小（768px: 14px → 13px，480px: 13px）
- 减小段间距（8px → 6px，6px → 4px）
- 减小行间距（1.85 → 1.6，1.6 → 1.5）
- 优化阅读区内边距，让内容显示更紧凑

**导出功能优化**
- 移动端导出按钮功能从「导出当前章节」改为「导出整本小说」

---

## [0.5.3] - 2026-04-30

### 🔧 改进优化

**Android 图标尺寸规范化**
- 按照 Tauri 官方文档调整 Android 应用图标尺寸
- 修复 Android 项目生成问题，重新初始化 Android 项目
- 适配多分辨率设备（mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi）

### 🐛 Bug 修复

**Android 构建错误修复**
- 删除失效的 `gen/android` 目录，使用 `tauri android init` 重新生成
- 修复 CI 环境中的 Android 构建路径问题

---

## [0.5.2] - 2026-04-30

### 🔧 改进优化

**阅读背景颜色优化**
- 新增 4 种阅读背景颜色：薰衣草、桃色、鼠尾草、石板
- 背景选项整体居中显示，优化布局
- 所有背景颜色搭配相应的文字颜色，确保在亮色/暗色模式下清晰可读
- 按钮尺寸优化（36px），确保圆形按钮美观

**段间距调整优化**
- 将段间距调整功能扩展到校对模式（非阅读模式）
- 阅读模式下默认使用 50% 的段间距（最小 4px），让阅读更紧凑
- 校对模式下保持完整段间距，便于段落区分和修改定位

**章节标题显示优化**
- 章节标题超出显示区域时自动截断并显示省略号
- 避免长标题覆盖阅读模式开关按钮
- 添加 `flex: 1` 和 `min-width: 0` 确保 flex 容器中的文本截断正常工作

---

## [0.5.0] - 2026-04-30

### 🎉 新增功能

**API Key 可视化改进**
- 将 API Key 输入框改为换行显示，单独占用完整宽度
- 添加眼睛按钮，点击可切换密码显示/隐藏状态
- 使用内嵌 SVG 图标实现睁眼/闭眼状态切换

**自定义选项图标优化**
- 将"自定义"AI 模型配置的 logo 从外部图片改为内嵌 SVG 齿轮图标
- 提升页面加载速度和图标显示可靠性
- 使用灰色系配色，与整体 UI 风格保持一致

### 🔧 改进优化
**配置模态框布局优化**
- API Key 和模型名称输入框改为各自换行显示
- 提升表单填写体验，减少视觉拥挤感

### 🐛 Bug 修复

**React Hooks 警告修复**
- 修复 `ProofreadPanel.tsx` 中 `chapterResults` 的条件赋值导致依赖变化问题
- 将其包装在 `useMemo` 中优化性能
- 为 `useEffect` 添加缺失的依赖 `chapter`, `setResults`, `setStartLine`

**ESLint 配置警告修复**
- 将 `.eslintignore` 文件内容迁移到 `eslint.config.js` 的 `globalIgnores` 配置中
- 删除不再受支持的 `.eslintignore` 文件

### 📦 技术栈

- Tauri: 2.x
- React: 18.x
- TypeScript: 5.x
- Vite: 8.x

---

## [0.3.0] - 2026-04-XX

### 🎉 新增功能

**Windows ARM64 支持**
- 添加 Windows ARM64 构建目标（aarch64-pc-windows-msvc）
- 支持 ARM 架构设备（Surface Pro X、骁龙笔记本等）
- 同时生成 x86_64 和 ARM64 两个版本

**阅读区与校对区联动高亮**
- 点击阅读区段落时，校对区自动高亮对应行
- 点击校对区段落时，阅读区自动高亮对应行
- 无需先进行校对检测即可联动

### 🔧 改进优化

**UI 高亮样式优化**
- 移除蓝色渐变背景，改用纯色深色/浅色背景
- 深色模式：使用较浅的深灰色背景
- 亮色模式：使用较深的浅灰色背景
- 行号与段落使用统一的高亮样式

**MiSans 字体**
- 全局字体更换为小米 MiSans
- 提升中文显示效果

**GitHub Actions 优化**
- 添加 FORCE_JAVASCRIPT_ACTIONS_TO_NODE24 适配 Node.js 24
- 移除 Node.js 20 弃用警告
- Artifact 上传禁用压缩（compression-level: 0），加快上传和下载速度

**Android 构建优化**
- 产物命名格式：ProofReader-v{版本号}-{架构}.apk
- 明确指定 release 版本路径
- 支持版本号自动注入

### 🐛 Bug 修复

**阅读区-校对区联动问题**
- 修复点击阅读区后校对区无法高亮对应行的问题
- 使用 useMemo 确保即使没有校对结果也能显示段落列表

**移动端布局修复**
- 修复章节、校对、剧本面板只显示半屏的问题
- 修复提示词输入框提前换行的问题
- 优化 flex 布局层级

**设置按钮溢出修复**
- 移动端设置按钮只显示图标，不显示文字
- 防止文字溢出圆角框

### 📦 技术栈

- Tauri: 2.x
- React: 18.x
- TypeScript: 5.x
- Vite: 8.x
- Node.js: 24（GitHub Actions）

---

## [0.2.5] - 2026-04-XX

### 🎉 新增功能

**Windows ARM64 支持**
- 添加 Windows ARM64 构建目标
- 支持 ARM 架构设备（如 Surface Pro X、骁龙笔记本等）
- 同时生成 x86_64 和 ARM64 安装包

**应用名称优化**
- 英文名称：Novel Proofreader → Proof Reader
- 中文名称：小说校对助手 → 校对助手
- 统一产品标识，更简洁专业

### 🔧 改进优化

**移动端布局修复**
- 修复章节、校对、剧本面板只显示半屏内容的问题
- 修复提示词输入框在屏幕 40% 宽度位置换行的问题
- 优化 flex 布局层级，确保内容正确填充可用空间
- 添加 min-height: 0 解决嵌套 flex 容器高度计算问题

**GitHub Actions 配置优化**
- build.yml：保留自动触发（push tags）
- macos.yml、windows.yml、linux.yml、android.yml：改为仅手动触发
- 支持按需构建，避免不必要的资源消耗

**Android 设置按钮修复**
- 修复移动端设置按钮文字溢出圆框问题
- 仅显示图标（⚙️），不显示文字
- 优化按钮尺寸和圆角

**代码质量提升**
- 修复 React Hooks 问题（useMemo、useCallback）
- 添加 ESLint 忽略配置
- TypeScript 编译通过，零类型错误

### 🐛 Bug 修复

**布局问题修复**
- 修复 .app-body 高度计算问题
- 修复各面板 overflow-y: auto 不生效问题
- 修复提示词输入框宽度问题

**构建问题修复**
- 修复 Tauri 配置验证错误
- 修复 Android 状态栏重叠问题

---

## [0.2.0] - 2026-04-29

### 🎉 新增功能

**Apple Liquid Glass 设计风格**
- 实现了动态渐变背景效果
- 添加磨砂玻璃视觉效果
- 流畅的动画过渡效果

**响应式布局适配**
- 桌面端：左右分屏布局
- 移动端（< 768px）：上下分屏布局
- 底部标签栏导航

**AI 模型配置页面优化**
- 重新设计配置弹窗 UI
- 支持多种 AI 提供商选择（OpenAI、DeepSeek、SiliconFlow、Mimo、LM Studio）
- 新增调试日志开关

**剧本改编功能**
- 支持按段落/按行/整章转换
- 可选择起始位置
- 自定义提示词支持

### 🔧 改进优化

**React Hooks 最佳实践**
- 使用 useMemo 优化计算性能
- 使用 useCallback 优化回调函数
- 修复 useEffect 中 setState 导致的级联渲染问题

**代码质量提升**
- ESLint 检查通过（零警告）
- TypeScript 类型安全增强
- 删除未使用的变量和导入

**Android 平台支持**
- 添加状态栏安全区域支持
- 修复设置按钮溢出问题
- 优化移动端按钮布局

**应用名称更新**
- 英文：Novel Proofreader → Proof Reader
- 中文：小说校对助手 → 校对助手

### 🐛 Bug 修复

**构建错误修复**
- 修复 Tailwind CSS 依赖问题
- 修复 Tauri 配置验证错误
- 修复 Android 构建配置问题

**UI 修复**
- 修复移动端设置按钮文字溢出圆框问题
- 修复章节切换时状态重置问题
- 修复文本区域高度自适应问题

**GitHub Actions 修复**
- 修复 workflow 语法错误
- 修复签名配置问题
- 修复 artifacts 上传配置

### 📦 技术栈更新

- Tauri: 2.x
- React: 18.x
- TypeScript: 5.x
- Vite: 8.x

### 🚀 部署说明

支持以下平台构建：
- macOS (dmg)
- Windows (exe/msi)
- Linux (deb/AppImage)
- Android (apk/aab)
