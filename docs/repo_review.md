# Repo Deep Dive Report — Skills Hub

> Repo: `skills-hub` (Tauri + React)  
> Workspace path: `/Users/liangpn/ai/skills-hub`  
> Branch/Commit: `main` @ `6551a6ec049fc6396276a58a9c4228a4d874fd53`  
> Report audience: 二次开发（你）/后续贡献者  

本报告目标：在**证据可追溯**（文件路径 + 关键符号）的前提下，建立一份“脑内地图”，并指出最值得扩展的切入点与改进建议。

---

## 1) 全局地图（Architecture Map）

### 1.1 顶层目录职责

- `src/`：前端（React + Vite）。核心是 `src/App.tsx`（当前采用“Tabs”形式切换 Skills / Analytics）。
- `src-tauri/`：后端（Rust + Tauri）。核心是 `src-tauri/src/lib.rs`（Tauri Builder + DB 初始化 + command 注册）。
- `docs/`：设计文档与截图。已有系统设计：`docs/system-design.md` / `docs/system-design.zh.md`。
- `scripts/`：一些工程脚本（版本同步、icon、覆盖率等）。
- `work/`：工作文档（本仓库约定的 WIP 目录）。

### 1.2 组件级依赖图（Mermaid）

```mermaid
flowchart LR
  subgraph FE[Frontend: React + Vite]
    App[src/App.tsx]
    SkillsUI[src/components/skills/*]
    AnalyticsUI[src/components/analytics/*]
    App --> SkillsUI
    App --> AnalyticsUI
    App -->|invoke(command,args)| TauriInvoke
  end

  subgraph BE[Backend: Rust + Tauri]
    Lib[src-tauri/src/lib.rs]
    Cmd[src-tauri/src/commands/mod.rs]
    Core[src-tauri/src/core/*]
    Store[src-tauri/src/core/skill_store.rs]
    Lib --> Cmd
    Cmd --> Core
    Core --> Store
  end

  TauriInvoke --> Cmd
  Store --> FS[(File System)]
  Store --> DB[(SQLite)]
  Core --> FS
```

### 1.3 关键模块索引（后端 core）

`src-tauri/src/core/mod.rs` 暴露的主要模块：

- `central_repo`：中央仓库路径解析与创建（`resolve_central_repo_path` / `ensure_central_repo`）。
- `skill_store`：SQLite schema + CRUD（skills/targets/settings/usage events + cursors）。
- `installer`：本地导入、Git 导入、从源更新（local/git）。
- `git_fetcher`：Git clone/pull；优先系统 `git`，可选回退 libgit2（环境变量控制）。
- `sync_engine`：把 central repo 的 skill 映射到各工具的 skills 目录（symlink/junction/copy）。
- `tool_adapters`：各工具目录规则、检测、扫描本机已存在 skills（Onboarding 依赖）。
- `onboarding`：扫描/聚合本机已有 skills，按 fingerprint 检测冲突，生成“接管/导入计划”。
- `codex_analytics`：扫描 `~/.codex/sessions/**/rollout-*.jsonl`，生成 Codex 的 skill 使用统计（本次新增）。
- `cache_cleanup` / `temp_cleanup`：清理 git cache / git temp（安全策略：prefix + marker 文件）。
- `github_search`：GitHub 搜索（`/search/repositories`）。

---

## 2) 入口点与关键链路（Entrypoint → Critical Path）

### 2.1 App 启动链路（Rust/Tauri）

入口：`src-tauri/src/main.rs` → `app_lib::run()`（`src-tauri/src/lib.rs:9`）。

`src-tauri/src/lib.rs:9` 做了三件关键事：

1) 初始化插件：dialog / opener / updater / log（`src-tauri/src/lib.rs:10-24`）
2) 初始化 DB：`default_db_path` → `migrate_legacy_db_if_needed` → `SkillStore::ensure_schema`，并 `app.manage(store)` 注入全局 state（`src-tauri/src/lib.rs:26-30`）
3) 注册所有 command（前端 `invoke` 的 API 面）：`tauri::generate_handler![...]`（`src-tauri/src/lib.rs:64-94`）

另外还有两个后台清理任务：

- 删除旧的 git temp dirs（prefix `skills-hub-git-*` + marker `.skills-hub-git-temp`）：`core::temp_cleanup::cleanup_old_git_temp_dirs`（`src-tauri/src/lib.rs:40`）
- 删除 git cache dirs（路径来自 `app_cache_dir()/skills-hub-git-cache`）：`core::cache_cleanup::cleanup_git_cache_dirs`（`src-tauri/src/lib.rs:55`）

### 2.2 前端入口与 command 调用方式

- 前端入口：`src/main.tsx` 渲染 `src/App.tsx`
- `src/App.tsx:78` 封装了 `invokeTauri<T>(command,args)`；非 Tauri 环境会抛 `errors.notTauri`。

这意味着：**绝大多数业务能力都必须通过 `src-tauri/src/commands/mod.rs` 暴露**，前端是状态/交互层。

### 2.3 “导入 Skill（本地目录）”关键路径（概念链路）

调用链：

1) 前端：Add Skill → `invoke('install_local', { path, name })`（见 `src/App.tsx` / `src/components/skills/modals/AddSkillModal.tsx`）
2) 后端 command：`install_local`（`src-tauri/src/commands/mod.rs`）  
3) core：`installer::install_local_skill`（`src-tauri/src/core/installer.rs:26`）
4) core：`central_repo::resolve_central_repo_path` + `ensure_central_repo`（`src-tauri/src/core/central_repo.rs`）
5) core：`sync_engine::copy_dir_recursive` 把目录复制到 central repo（`src-tauri/src/core/sync_engine.rs:173`）
6) store：`SkillStore::upsert_skill` 写入 `skills` 表（`src-tauri/src/core/skill_store.rs:268`）

### 2.4 “导入 Skill（Git URL）”关键路径（概念链路）

核心差异：**永远先 clone 到 cache，然后再 copy 到 central repo**，避免 central repo 内含 `.git`。

关键点：

- `installer::install_git_skill`（`src-tauri/src/core/installer.rs:82`）
- `git_fetcher::clone_or_pull` 优先系统 git（`src-tauri/src/core/git_fetcher.rs:10`）
- “multi-skill 仓库 root URL”会返回 `MULTI_SKILLS|...`，让用户选择具体 folder URL（`src-tauri/src/core/installer.rs:145` 附近）

### 2.5 同步到工具（symlink/junction/copy）

同步策略集中在 `src-tauri/src/core/sync_engine.rs`：

- `sync_dir_for_tool_with_overwrite`：对 Cursor 强制 copy（`src-tauri/src/core/sync_engine.rs:117-128`）
- 其它工具：优先 symlink（unix），Windows 尝试 junction，再不行 copy（`sync_dir_hybrid`）
- 安全行为：如果 target 已存在默认报错（需要显式 overwrite flow）

### 2.6 Onboarding（扫描本机已有 skills → 导入/接管）

Onboarding 的“发现”来自 `tool_adapters::scan_tool_dir`（`src-tauri/src/core/tool_adapters/mod.rs:157`）：

- `default_tool_adapters()` 定义所有工具的相对目录规则（`src-tauri/src/core/tool_adapters/mod.rs:42`）
- 过滤：Codex 的 `.system` 被跳过（`src-tauri/src/core/tool_adapters/mod.rs:177-179`）
- 过滤：排除 “Tauri dev app_data_dir” 的路径（用字符串 hint `Application Support/com.tauri.dev/skills`，见 `src-tauri/src/core/tool_adapters/mod.rs:171`）

Onboarding 的“冲突检测”：

- `content_hash::hash_dir` 用 SHA-256 遍历目录内容（忽略 `.git` / `.DS_Store` / `Thumbs.db` / `.gitignore`）：`src-tauri/src/core/content_hash.rs`

### 2.7 Analytics（Codex 使用统计）

数据源：仅扫描 `~/.codex/sessions/**/rollout-*.jsonl`（`src-tauri/src/commands/mod.rs:196-204`）。

核心流程：

- 逐行 parse JSONL → 命中 `function_call` + `shell_command` → 从 command 中提取 `use-skill <skill_key>`  
  见：`src-tauri/src/core/codex_analytics.rs:59`（`parse_rollout_line_for_use_skill`）
- “只统计存在于 `~/.codex/skills/**` 的技能”：`canonicalize_codex_skill_key`（`src-tauri/src/core/codex_analytics.rs:279`）
  - 支持把 `superpowers:<name>` 归一化成 `<name>`（前提：`~/.codex/skills/<name>` 存在）
- 增量扫描：为每个 log_path 维护游标 `codex_scan_cursors`（避免重复计数）
- “默认不回溯”：启用统计时把现有文件游标设到 EOF；需要用户手动“历史回填”（前端面板已提供）

---

## 3) 数据模型（SQLite）

DB 初始化：`SkillStore::ensure_schema`（`src-tauri/src/core/skill_store.rs:157`）

主要表：

- `skills`：Hub 托管的技能（central repo 内的目录）
- `skill_targets`：技能在每个 tool 下的映射状态（mode/target_path/synced_at）
- `settings`：简单 KV（central repo path、analytics config、git cache config 等）
- `discovered_skills`：Onboarding 扫描的候选（是否已导入等）
- `skill_usage_events`：Analytics 事件表（`skill_key` + optional `managed_skill_id`，以及 log source 行号去重）
- `codex_scan_cursors`：每个 rollout log 的 last_line 游标

值得注意的 schema 策略：

- `PRAGMA user_version` + `SCHEMA_VERSION` 做简单迁移（当前 version=3，见 `src-tauri/src/core/skill_store.rs:13`）
- `skill_usage_events` 用 `UNIQUE(tool, log_path, log_line)` 保证幂等（增量/回填都安全）

---

## 4) 可扩展点（Extension Points）

### 4.1 新增/调整工具适配

集中修改：

- `src-tauri/src/core/tool_adapters/mod.rs`：新增 ToolId、display name、skills dir、detect dir
- 若需要特殊同步策略：在 `src-tauri/src/core/sync_engine.rs` 增加按 tool_key 的分支（类似 Cursor 强制 copy）

### 4.2 新增导入来源

现有来源：

- local folder：`installer::install_local_skill`
- git url + folder url：`installer::install_git_skill` / `install_git_skill_from_selection`

可新增：

- zip 文件导入（UI 选文件 → 解压 → copy into central）
- “从工具目录接管”的快捷导入（基于 onboarding 扫描结果）

### 4.3 新增 Analytics（其它工具）

现有 Analytics 是 Codex 专用，结构上已经具备通用形态：

- “事件表”按 `tool` 分区（`skill_usage_events.tool`）
- 只需为新工具实现：日志发现 + 事件解析 + 游标策略（可复用 `skill_usage_events`）

---

## 5) Getting Started（开发上手）

见 `README.md`：

- `npm install` / `npm run tauri:dev`
- `npm run lint` / `npm run build` / `npm run tauri:build`
- Rust tests：`cd src-tauri && cargo test`

---

## 6) 评分（Scorecard，100 分制）

> 评分基于当前代码（commit `6551a6e`）的可维护性、扩展性与稳定性；每项给出证据点。

- 架构清晰度：**14/15**
  - 前后端边界明确：`invoke_handler` + `commands/mod.rs` + `core/*` 分层清楚。
  - 已有系统设计文档：`docs/system-design.md`。
- 可扩展性：**13/15**
  - tool adapters 集中配置，扩展点明确（`tool_adapters/mod.rs`）。
  - 但前端页面组织目前偏“单文件 App 状态机”（`src/App.tsx` 很大）。
- 可靠性/幂等：**13/15**
  - sync 有 overwrite 控制；analytics 事件去重；git temp 清理有 marker safety。
  - 但对跨平台权限/沙盒的处理仍可更显式（尤其缓存目录写入）。
- 错误处理与可诊断性：**12/15**
  - `format_anyhow_error` 对 GitHub clone 失败提供用户可读提示（`src-tauri/src/commands/mod.rs:34`）。
  - analytics 面板加入 `matched/skipped/dups` 调试计数。
- 性能：**8/10**
  - 大量 IO 操作目前偏“全量 copy”，但有合理限制与缓存策略。
- 安全性：**8/10**
  - 对删除缓存目录采用 prefix + marker + age 的三重限制（`temp_cleanup.rs` / `cache_cleanup.rs`）。
  - 仍可补充更多“路径安全校验”的统一工具函数（目前分散在若干模块）。
- 测试覆盖：**10/10**
  - core 有较多 Rust 单测（`src-tauri/src/core/tests/*`），新增 analytics 也带测试。
- 文档：**9/10**
  - 设计文档较完善，但缺少“二次开发指南”（例如如何添加新 tool / 新 analytics 的步骤模板）。

**总分：87/100**

---

## 7) 高杠杆改进建议（按收益/成本排序）

1) **前端模块化 App 状态机**
   - `src/App.tsx` 继续增长会变得难维护；建议把 analytics / skills 两个 Tab 拆到独立页面组件，并收敛 command 调用到一个 service 层（例如 `src/lib/tauri.ts`）。
2) **为“导入/同步/更新”补一个统一的 dry-run / 预检层**
   - 现在 overwrite、target exists、tool not installed 依赖错误前缀分支；可以把这些规则抽成可复用的“计划/预检”对象，减少 UI 分支复杂度。
3) **补齐对权限/沙盒路径的可配置性**
   - git cache 目前在 `app_cache_dir()/skills-hub-git-cache`，某些环境（CI/沙盒）会失败；可以在 settings 提供“cache path override”（高级选项）。
4) **清理未使用的 Router-based UI 代码**
   - `src/components/Layout.tsx` / `src/pages/Dashboard.tsx` 当前看起来未被 `App.tsx` 使用；若不计划启用 Router，可以移除避免误导。

---

## Appendix：相关文件速查

- 前端入口：`src/main.tsx`
- 前端主页面：`src/App.tsx`
- Analytics 面板：`src/components/analytics/CodexAnalyticsPanel.tsx`
- Tauri 入口：`src-tauri/src/main.rs` / `src-tauri/src/lib.rs`
- Commands：`src-tauri/src/commands/mod.rs`
- DB：`src-tauri/src/core/skill_store.rs`
- 导入/更新：`src-tauri/src/core/installer.rs`
- 同步：`src-tauri/src/core/sync_engine.rs`
- Tool adapters：`src-tauri/src/core/tool_adapters/mod.rs`
- 迁移接管：`src-tauri/src/core/onboarding.rs`
- Codex Analytics：`src-tauri/src/core/codex_analytics.rs`

