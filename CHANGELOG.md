# Proof Reader Changelog

## v0.9.1 (2026-05-15)

### 🐛 Bug 修复

**阅读区滚动同步问题修复**
- 修复点击校对区后阅读区无法正确滚动到对应位置的问题
- 优化滚动定位逻辑，使用更精确的元素位置计算

### 🔧 改进优化

**代码结构优化**
- 新增角色管理功能，支持为小说配置角色信息与音色
- 新增剧本/小说AI情感增强TTS朗读功能
- 重构TTS播放逻辑，支持角色音色差异化配音
- 优化移动端阅读模式布局与播放控制
- 升级API使用统计与配置表单体验

## v0.9.0 (2026-05-14)

### 🐛 Bug 修复

**阅读区搜索按钮搜索弹窗样式修复**
- 修复 search-modal 与 config-modal 设计不一致的问题
- 统一了头部、关闭按钮和内容区域等结构和样式

### 🔧 改进优化

**阅读进度组件重新设计**
- reading-progress 现在显示当前章节的阅读进度百分比
- 新增进度条可视化，直观展示阅读进度
- 新增基于当前阅读速度的预计剩余时间显示
- 阅读进度随页面滚动自动更新（Intersection Observer）
- 不再依赖段落点击来更新进度

**全局搜索弹窗优化**
- global-search-modal 现在像 config-modal 一样居中显示
- 统一了 modal-overlay 结构和样式
- 优化移动端显示，修复挤压问题

**校对队列面板可视化升级**
- queue-stats 现在采用类似 usage-stats 的卡片式设计
- 不同状态使用不同颜色：pending（默认）、running（加载中）、done（成功）、failed（失败）
- 优化 queue-section 和 queue-actions 的可视化效果

**导出功能优化**
- ExportData 函数现在导出到单独的文件
- 设置导出为单个文件
- 每部小说数据分别导出为单独文件
- 更便于管理和查看导出数据

**遮罩层样式统一**
- modal-overlay、global-search-overlay、queue-panel-overlay、chapter-list-overlay 全部统一
- 使用 React Portal 在 document.body 层级渲染，解决 z-index 和定位问题

## v0.8.9 (2026-05-13)

### 🐛 Bug 修复

**阅读区搜索功能修复**
- 修复搜索按钮消失的问题（被错误地限制为仅阅读模式显示）
- 修复搜索结果行号与阅读区显示行号不匹配的问题
- 问题根因：搜索结果存储使用原始索引，但阅读区高亮和滚动使用过滤后索引，导致空行存在时行号不一致
- 修复方案：搜索结果统一使用原始索引存储，`paragraphIndexMap[filteredIndex]` 获取原始索引，确保搜索结果行号与阅读区显示一致

### 🔧 改进优化

**搜索按钮重新显示**
- 将搜索按钮从仅阅读模式显示改为在所有模式下都可访问
- 搜索按钮移至 reader-toolbar 区域，不再隐藏在悬浮操作按钮中

**ChapterNav 布局优化**
- 优化 nav-header 水平内边距，增加元素间距
- 改善 nav-header-actions 内部元素布局，解决拥挤问题

**日志系统增强**
- 扩展 logger.ts 增加多种功能模块专用日志方法：`proofread`、`search`、`tts`、`file`、`ui`、`debug`、`warn`、`errorGeneric`
- 统一日志开关控制，通过 ConfigModal.tsx 的 toggle-switch 控制

**剧本改编功能简化**
- 移除转换粒度选择功能，直接按章节转换
- 移除段落选择功能，简化为整章内容转换
- 代码复杂度降低，用户操作更简洁

## v0.8.8 (2026-05-10)

### 🐛 Bug 修复

**校对区段落索引错位问题**
- 修复点击 btn-check 后校对区第一、第二行无法显示检测状态和结果的问题
- 问题根因：当 `granularity !== "chapter"` 时，初始化结果数组只包含非空段落，但后续调用 `updateParagraphResult` 时使用原始段落索引（包含空段落），导致数组索引与段落索引不匹配
- 修复方案：修改 `useAICheck.ts` 中 `checkChapter` 函数，在非章节模式下也初始化所有段落（包括空段落），确保数组索引与原始段落索引一致

**采纳修改时高亮位置错误问题**
- 修复段落中有多个相同字符时，采纳修改会错误地高亮第一个匹配项而非正确位置的问题
- 问题根因：`ReaderPanel.tsx` 的 `getHighlightInfo` 函数在 `highlight-new` 阶段使用 `para.indexOf(newText)` 查找位置，当文本中有多个相同字符时会返回第一个匹配项
- 修复方案：优先使用精确位置，验证位置处文本是否与新文本匹配，只有位置不匹配时才降级使用 `indexOf`

**移动端滑动误触发点击问题**
- 修复在移动端滑动页面时意外选中高亮段落的问题
- 问题根因：滑动结束后会触发 `onClick` 事件，导致用户只是滚动页面却意外选中了段落
- 修复方案：在 `ReaderPanel.tsx` 中添加滑动检测逻辑（`isScrolling`），在 `touchMove` 时检测移动距离超过阈值则标记为滚动操作，点击时不触发选中

**移动端点击同步滚动定位偏差问题**
- 修复在移动端点击校对区后阅读区滚动定位不准确的问题
- 问题根因：`scrollToElement` 函数使用 `el.offsetTop` 计算滚动位置，在有工具栏的布局中会不准确
- 修复方案：使用 `getBoundingClientRect()` 获取容器和元素的精确位置，计算元素相对于容器顶部的偏移量来计算目标滚动位置

**ReaderPanel 滚动行为与 ProofreadPanel 不一致问题**
- 修复阅读区点击后校对区无法正确居中显示对应段落的问题
- 修复阅读区和校对区滚动同步逻辑过于复杂的问题
- 问题根因：ReaderPanel 和 ProofreadPanel 的 ref 索引逻辑不一致；ReaderPanel 使用了不必要的滚动同步逻辑
- 修复方案：统一 ReaderPanel 的 ref 索引逻辑使用 `originalIndex`；简化滚动逻辑移除不必要的同步滚动，保留点击选中后的同步滚动功能

### ✨ 新功能

**error-count 点击跳转功能**
- 新增点击错误计数快速跳转到第一个未处理错误所在段落的功能
- 当有未处理错误时，error-count 区域显示为可点击状态（鼠标悬停显示手型和颜色变化）
- 点击后自动选中并滚动到第一个包含未处理错误（未采纳且未跳过）的段落

### 🔧 改进优化

**proofread-toolbar 固定显示**
- 修改校对区工具栏为固定显示，不再跟随滑动消失
- 使用 `position: sticky` 配合背景色实现固定效果
- 修复了因 `overflow: hidden` 阻止 sticky 生效的问题

**TaskPanel 样式优化**
- 优化 `segment-index` 和 `segment-title` 的布局对齐
- 添加 `display: inline-flex` 和 `align-items: baseline` 使图标和文字并排显示并与标题持平

**同步滚动功能移除**
- 移除了阅读区和校对区滑动时的同步滚动功能
- 保留点击选中某行后另一个区域滚动到对应段落的功能

**AI Prompt 模板优化**
- 更新了 PROOFREAD_SYSTEM_PROMPT（段落校对提示词）
- 更新了 PROOFREAD_SYSTEM_PROMPT_CHAPTER（章节校对提示词）
- 更新了 SCRIPT_SYSTEM_PROMPT（剧本改编提示词）
- 更新了 DEFAULT_PROMPT（默认提示词，指向 SCRIPT_SYSTEM_PROMPT）
- 优化了校对和剧本转换的 AI 提示词，提升输出质量

**ReaderPanel 高亮滚动逻辑重构**
- 简化 `scrollToParagraph` 函数，与 ProofreadPanel 保持一致的实现方式
- 使用 `el.scrollIntoView({ behavior: "smooth", block: "center" })` 实现居中滚动
- 添加 `setTimeout(50ms)` 确保 DOM 渲染完成后再滚动
- 移除不再需要的 `scrollLock` 机制

---

## v0.8.7 (2026-05-10)

### 🐛 Bug 修复

**动画高亮定位偏差问题**
- 修复 `anim-highlight-old` 和 `anim-highlight-new` 高亮定位存在偏差的问题
- 问题根因：新文本高亮时直接使用原始索引，但 `correctedText` 与 `originalText` 长度可能不同
- 修复方案：在 `ReaderPanel.tsx` 中，新文本高亮阶段使用 `para.indexOf(newText)` 动态查找新文本在实际段落中的位置，而非使用固定索引
- 旧文本高亮（`highlight-old` / `replacing` 阶段）继续使用原始索引，因为此时段落内容尚未改变
- 添加降级处理：如果新文本在段落中找不到，则使用原始索引作为备选方案

---

## v0.8.6 (2026-05-09)

### ✨ 新功能

**校对操作反馈**
- 新增文件：`src/components/Toast.tsx`（Toast消息组件）
- 添加了 Toast 消息提示组件，为采纳修改、撤销、跳过等操作提供明确的成功/失败反馈
- Toast 组件支持成功、错误、警告、信息四种类型，自动3秒后消失

### 🔧 改进优化

**AI校对结果显示问题**
- 修复了AI大模型返回数据后，错误信息无法在对应段落的校对区正确显示的问题
- 问题根因：`checkSingleLine` 函数在初始化结果数组时，未考虑现有结果数组长度小于实际段落数的情况，导致索引错位
- 修复方案：优化初始化条件，当现有结果数组长度不足时重新初始化，并保留已有数据
- 优化了 `useAICheck.ts` 中的索引映射逻辑，确保段落索引与结果数组正确对齐
- 完善了 `proofreadStore.ts` 中 `updateParagraphResult` 的索引处理，强制使用正确的段落索引
- 清理了调试日志，保持代码整洁
- 样式更新：`src/App.css`（添加Toast组件样式）

---

## [0.8.5] - 2026-05-08

### ✨ 新功能

**忽略单词管理**
- 新增忽略单词管理弹窗，支持按章节管理校对时需要跳过的单词（如人名、地名、特殊术语等）
- 校对工具栏新增"忽略单词管理"按钮（⚙️），点击打开管理弹窗
- AI 校对时自动将忽略列表中的单词排除，不再标记为错误
- 支持添加、删除、批量管理忽略单词
- proofreadStore 新增 ignoredWords 状态管理（add/remove/get/clear）

### 🔧 改进优化

**忽略单词管理弹窗 UI**
- 采用 Liquid Glass 设计风格，带毛玻璃背景（backdrop-filter: blur(20px)）
- 忽略单词标签（word-tag）采用圆形 pill 设计，删除按钮为圆形
- 弹窗 z-index 层级优化，确保内容始终在遮罩层上方
- 新增 `--r-full: 9999px` CSS 变量，统一圆形设计语言

**校对工具栏按钮样式统一**
- 取消按钮（btn-cancel）样式从红色改为与整体风格一致的灰色
- 新增忽略单词管理按钮（btn-ignored-words），悬停时显示蓝色高亮效果

### 🐛 Bug 修复

**忽略单词管理弹窗交互修复**
- 修复点击弹窗内容区域无法交互的问题（z-index 层叠冲突）
- 修复全局 modal-overlay 的 backdrop-filter 泄漏到忽略单词弹窗的问题
- 修复忽略单词删除后列表不立即更新的问题（getIgnoredWords 改为响应式选择）

---

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
