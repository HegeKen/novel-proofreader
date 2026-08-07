---
alwaysApply: true
---

# 基本要求

- 使用中文回复
- 代码注释用中文

# 项目概述

小说校对工具（novel-proofreader），基于 Tauri + React 19 + TypeScript 的桌面应用，支持 AI 校对、角色管理、TTS 朗读、文本对比等功能。

## 技术栈

- **框架**: React 19 + TypeScript（严格模式）
- **构建**: Vite 8
- **状态管理**: Zustand 5（含 persist 中间件）
- **样式**: Tailwind CSS 4 + 全局 App.css（CSS 变量驱动）
- **桌面壳**: Tauri 2
- **图标**: lucide-react（统一通过 `src/components/Icons.tsx` 导出）
- **测试**: Vitest 4 + Testing Library

# 代码风格

## 文件组织

- 每个文件顶部用注释块标识用途，格式统一：
  ```ts
  // ============================================================
  // 文件用途简述
  // ============================================================
  ```
- 组件文件使用 PascalCase（如 `DiffModal.tsx`）
- 工具/Hook 文件使用 camelCase（如 `useAICheck.ts`、`textDiff.ts`）
- 测试文件放在对应目录的 `__tests__/` 子目录下

## TypeScript 规范

- 始终启用严格类型，避免 `any`，必要时用 `unknown` 替代
- 接口与类型定义放在文件顶部或 `src/types/index.ts`
- 组件 Props 必须显式定义 `interface Props`
- 优先使用 `type` 导入：`import type { ... }`

## React 规范

- 函数组件 + Hooks，不使用 class 组件
- 状态更新使用 `useCallback` 包裹事件处理函数
- 派生状态用 `useMemo`，避免不必要的重计算
- 大型弹窗组件用 `lazy()` 动态导入
- 副作用清理：`useEffect` 必须返回清理函数（如有订阅/定时器）

## Zustand Store 规范

- Store 文件放在 `src/stores/`，每个 store 职责单一
- 使用 `create` + `persist` 中间件持久化需要的状态
- 选择器用法：`useNovelStore((s) => s.novels)`，避免整 store 订阅
- 跨 store 调用用 `useXxxStore.getState()`（非 React 上下文内）

# 设计系统（Apple Liquid Glass）

## CSS 变量

所有颜色、圆角、阴影、过渡必须使用 `:root` 定义的 CSS 变量，禁止硬编码：

- 颜色：`--accent`、`--text-primary`、`--text-secondary`、`--text-muted`、`--red`、`--green`、`--yellow`
- 背景：`--bg-surface`、`--bg-raised`、`--bg-hover`、`--glass-bg`、`--glass-bg-strong`
- 边框：`--border`、`--border-strong`、`--glass-border`
- 圆角：`--r-xs`(6px) / `--r-sm`(10px) / `--r-md`(14px) / `--r-lg`(20px) / `--r-xl`(28px)
- 阴影：`--shadow-sm` / `--shadow-md` / `--shadow-lg` / `--shadow-glow`
- 过渡：`var(--duration) var(--ease)`

## 组件结构约定

### 弹窗（Modal）

统一结构，保持一致性：

- 外层遮罩：`.modal-overlay` 或 `.diff-overlay` 等
- 内层容器：`.config-modal` / `character-settings-modal` / `novel-event-modal`（700px 宽，玻璃态）
- 头部：`.config-header` 包含 `.config-title`（带 `.title-icon`）和 `.close-btn`
- 内容区：`.config-body`

### 按钮

- 统一使用 `:where()` 中的 class（如 `.btn`、`.btn-primary`、`.btn-secondary`、`.close-btn`）
- 主操作用 `.btn-primary`，次要用 `.btn-secondary`
- 按钮内图标用 `<Icons.xxx size={16} />`
- 图标统一从 `Icons.tsx` 导出，新增图标先在 `Icons.tsx` 注册

### 浮动操作按钮（FAB）

- 角色操作类按钮放在屏幕右下角 `character-actions-fab-wrapper`（`position: fixed; bottom: 24px; right: 24px; z-index: 100`）

### 面板（Panel）

- `tts-panel`、`reading-settings-panel` 等使用统一结构：`.panel-header` + `.panel-title` + `.panel-body` + `.close-btn`

# 日志规范

- 使用 `src/utils/logger.ts` 的 `logger` 对象，不直接 `console.log`
- 日志方法：`logger.request()` / `logger.response()` / `logger.error()` / `logger.info()` / `logger.warn()` / `logger.debug()` / `logger.errorGeneric()`
- 日志标签用方括号前缀，如 `[DiffModal]`、`[TTS]`、`[AI]`
- TTS 服务日志用 `logger.tts()`，由 ConfigModal 调试设置控制开关

# 工程约定

## 修改原则

- 最小化改动：只改必要的代码，不顺手重构无关代码
- 不主动新增文档文件（.md），除非用户明确要求
- 优先编辑现有文件，不随意创建新文件
- 删除代码时彻底删除，不留 `// 已移除` 之类注释

## 测试

- 改动 `utils/`、`stores/` 下的逻辑后运行 `npx vitest run` 确认测试通过
- 测试文件与源文件同名，放在 `__tests__/` 目录

## 性能注意

- 大文本（>2000 字符）的逐字符 diff 会降级处理，避免 O(n*m) 性能问题
- 大列表渲染注意虚拟化或分页
- Zustand persist 的数据注意控制体积，超大内容（如小说全文）单独存储

# 提交规范

详见 `git-commit-message.md`，要点：

- 格式：`<type>: <中文简述>`（不超过 50 字，不以句号结尾）
- 类型：`feat` / `fix` / `refactor` / `perf` / `style` / `chore` / `docs` 等
- 仅在用户明确要求时才创建提交
