---
alwaysApply: true
scene: git_message
---

## Git 提交信息规范

### 格式

```
<type>: <简短描述>

<详细说明（可选）>
```

### 类型（Type）

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 代码重构 |
| `perf` | 性能优化 |
| `style` | UI 样式调整 |
| `security` | 安全相关 |
| `release` | 版本发布 |
| `chore` | 构建/工具/依赖 |
| `docs` | 文档更新 |

### 语言

- 主体描述使用**中文**
- 保持简洁，不超过 50 字
- 动词使用现在时（如"新增"而非"新增了"）
- 不要以句号结尾

### 示例

- `feat: 新增角色音色设计功能`
- `fix: 修复移动端导航栏未全屏显示的问题`
- `refactor: 重构安全存储模块，替换为 AES-GCM 加密`
- `style: 优化校对工具栏布局，统一按钮样式`
- `chore: 更新依赖版本`
- `release: bump version to 0.10.5`
