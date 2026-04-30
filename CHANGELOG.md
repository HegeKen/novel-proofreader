# Changelog

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
