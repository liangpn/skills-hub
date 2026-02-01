# Skills 修身炉（Skills Refinery）设计草案

> 本设计基于当前 Skills Hub 架构：前端 `src/App.tsx` + 后端 `src-tauri/src/commands/mod.rs` + core 模块。

## 1) 体验草图（信息架构）

建议在现有 `skills / analytics` 之外新增一个 Tab：

- `Refinery`：修身炉工作台（选择输入 → 点评 → 产出）

Refinery 页面分区（建议）：

- 左：可用 skills 列表（来源切换：Hub 托管 / 本机已安装 / URL 导入）
- 中：当前会话选中的 skills（支持排序、移除、备注）
- 右：点评 Agent 输出（结构化 report + 建议合并方案）
- 底：产出按钮（导出路径/名称）

## 1.1 Work Rules Library（统一保存目录）

工作准则（`work_rule`）不放在 Central Repo（`~/.skillshub`）里，而是单独目录：

- 默认：`~/.work-rules`
- 每条 work_rule 资产建议保存为目录：
  - `~/.work-rules/<name>/`
  - 包含：规范正文（固定 1 个入口文件，可命名为 `AGENTS.md` 或其它文件名）+ `manifest.json`（标签/评分/描述/来源等元信息）

## 2) 后端模块与命令（建议新增）

### 2.1 新增 core 模块

- `src-tauri/src/core/refinery.rs`（暂定）
  - `list_refinery_sources(...)`：列出可选 skills（managed + installed）
  - `read_skill_snapshot(path)`：读取目录树与核心文件（只读）
  - `analyze_skills(snapshot[])`：相似度/重复度/结构检查（本地算法）
  - `run_review_agent(...)`：调用 LLM provider（若启用）
  - `write_skill_output(...)`：在目标路径创建新 skill 目录（写入符合 `agentskills.io` 标准的 `SKILL.md` 等）
  - `write_work_rule_output(...)`：在 `~/.work-rules/<name>/` 写入 `manifest.json` + 入口文件

### 2.2 新增 tauri commands

在 `src-tauri/src/commands/mod.rs` 增加：

- `list_refinery_candidates`
- `get_skill_snapshot`
- `run_refinery_review`
- `export_refined_skill`
- `export_refined_work_rule`

## 3) 数据模型（两种可选路线）

### 路线 A：不落库（v1 简化）

会话与点评结果只保存在前端 state；导出时直接写目录。

优点：最快上线  
缺点：关闭 app 数据丢失；battle history 不可追踪

### 路线 B：轻量落库（推荐）

先不落 SQLite，采用 `manifest.json`（文件系统）保存元信息；后续如需要可再把“会话/报告”落库到 `SkillStore`。

## 4) 点评 Agent Provider 抽象（关键）

建议做一个 provider 接口（Trait），后续可以实现：

- `OpenAIProvider`（API key）
- `AnthropicProvider`

输出建议采用结构化 JSON schema（便于 UI 展示与 battle 复用），同时保留原文。

## 6) 安全策略（必须）

- 快照读取：限制在用户显式选择的目录；禁止 `..`、绝对路径穿越（复用现有 `is_safe_relative_path` 思路）
- 永不执行 scripts（仅展示/比较文本）
- URL 导入应走“缓存目录 + 只读解析”，不自动写入 `~/.codex/skills`（除非用户点击导出）

## 7) 导入项目（copy vs symlink）

- 默认：`copy`（项目内编辑不会影响规则库源文件）
- 可选：`symlink`（高级选项）
  - UI 必须提示风险：项目内编辑 = 修改规则库源文件；项目删除/覆盖可能破坏链接
  - 若创建 symlink 失败（权限/系统限制）：提示原因，并提供“改用 copy”选项让用户决定（不自动 fallback）
