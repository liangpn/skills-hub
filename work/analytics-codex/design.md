# Codex 使用统计（Analytics）设计文档（v1）

**目标**：在 Skills Hub 内提供一套“真实可计算”的 Codex skill 使用统计与排行榜（Leaderboard），用于判断哪些 skills 在哪些项目里用得多、最近是否还在用。

> v1 仅支持 **Codex**，仅统计能映射到 `~/.codex/skills/**` 的 skills（含 `.system/*`）。
>
> - 若日志为 `superpowers:<name>` 且 `~/.codex/skills/<name>` 存在，则按 `<name>` 计数。

---

## 1. 术语与口径

### 1.1 使用事件（usage event）

当且仅当 Codex 会话日志里出现一条事件满足以下条件，记为一次“使用事件”：

- JSONL 中一行事件的 `payload.type = "function_call"` 且 `payload.name = "shell_command"`
- `payload.arguments`（JSON 字符串）解析后包含字段 `command`
- `command` 命中模式：`... superpowers-codex use-skill <skill_key>`

其中 `<skill_key>` 形如 `.system/skill-installer`、`repo-deep-dive-report`、`brainstorming`，也可能是 `superpowers:writing-plans` 等（以空格分隔的下一个 token）。

v1 额外限制：只有当该 `<skill_key>` 能映射到 `~/.codex/skills/**` 时才计数；其中 `superpowers:<name>` 会在 `~/.codex/skills/<name>` 存在时归一化为 `<name>`。

> 重要说明：这个口径统计的是 **Codex 会话中触发“加载某 skill”的行为**（对应 CLI 中可见的调用提示），而不是“模型内部是否真正使用了某 skill 的所有规则”。v1 先以可验证、可落地为主。

### 1.2 调用次数 / 项目数 / 工具数

- **调用次数**：usage events 条数（可按 24h / 7d / all-time 聚合）。
- **项目数**：按 `project_path` 去重后的数量。
- **工具数**：
  - 若 `<skill_key>` 能关联到 Skills Hub 托管 skill（`managed_skill_id` 非空），则取 `skill_targets` 中该 `skill_id` 映射到的 `tool` 数量（来自 Hub 的同步记录，与日志无关）。
  - 否则显示 `1`（仅代表本次统计来源于 Codex；不代表该 skill 没有被安装到其它工具）。

### 1.3 项目路径归一化（默认）

默认规则（可配置）：

- 若 `workdir` 位于 git 仓库内，则 `project_path = git root`
- 否则 `project_path = workdir`

原因：避免同一仓库的不同子目录被计为多个“项目”。

---

## 2. 范围与非目标（v1）

### 2.1 范围（v1）

- 只读扫描目录：`~/.codex/sessions/**/rollout-*.jsonl`
- 仅统计存在于 `~/.codex/skills/**` 的 skills（含 `.system/*`）
  - 日志中出现但无法映射到 `~/.codex/skills/**` 的 `<skill_key>`：直接忽略（例如未安装同名个人 skill 的 `superpowers:*`）
- UI：新增 Tabs：`Skills` / `Analytics`
- Analytics v1：只做 Codex 使用统计模块（排行榜 + 详情 + 设置/开关）
- 数据保留：默认开启，保留 30 天（可配置）+ 手动清空
- 扫描方式：定时增量扫描（默认 5 分钟一次，最小 5 分钟），支持“立即扫描”

### 2.2 非目标（v1）

- 不直接统计 `~/.codex/superpowers/skills/**`（不会把 `superpowers:*` 作为独立 skill 维度；仅在能映射到 `~/.codex/skills/<name>` 时计数）
- 不读取 `~/.codex/history.jsonl`、`config.toml`、`auth.json` 等其它文件
- 不做 Claude / Cursor 等工具统计
- 不做“语义命中但没有 `use-skill` 记录”的推断统计
- 不做网络上报（纯本机）

---

## 3. 数据存储设计（SQLite）

现有表：

- `skills`：Hub 托管技能
- `skill_targets`：Hub 同步到各工具的映射（工具数来源）
- `settings`：KV 设置

新增（建议）：

### 3.1 `skill_usage_events`

用于记录可回放的使用事件（便于 24h/7d/trending 等聚合）。

字段建议：

- `id TEXT PK`
- `tool TEXT NOT NULL`（v1 固定为 `codex`）
- `skill_key TEXT NOT NULL`（来自日志的 `<skill_key>`）
- `managed_skill_id TEXT NULL`（可选关联到 Hub 托管 skill，用于查询 tools 数 / 未来导入入口等）
- `ts_ms INTEGER NOT NULL`（事件时间；优先解析日志 timestamp，失败则用当前时间）
- `workdir TEXT NOT NULL`
- `project_path TEXT NOT NULL`（归一化后的项目路径，v1 按用户选择存原始路径）
- `log_path TEXT NOT NULL`
- `log_line INTEGER NOT NULL`（1-based 行号）
- `created_at_ms INTEGER NOT NULL`

约束与索引：

- `UNIQUE(tool, log_path, log_line)`：防止重复扫描重复计数
- index：`(skill_key, ts_ms)`、`(managed_skill_id, ts_ms)`、`(project_path)`（便于聚合/详情）

### 3.2 `codex_scan_cursors`

用于增量扫描游标（按文件维度）。

- `log_path TEXT PRIMARY KEY`
- `last_line INTEGER NOT NULL`（已处理到的最大行号，1-based）
- `updated_at_ms INTEGER NOT NULL`

> 说明：不用“全局单一游标”，因为 rollout 文件会按日期/会话分片；按文件维护游标更稳。

---

## 4. 扫描与增量算法

### 4.1 文件发现

每轮扫描：

1) 遍历 `~/.codex/sessions/**/rollout-*.jsonl`  
2) 对每个 `log_path` 取游标 `last_line`（无则视为“新文件”）

### 4.2 启用统计时的“从现在开始”（不回溯）

开启 `analytics.codex.enabled=true` 时：

- 对当前已存在的所有 `rollout-*.jsonl`：将游标初始化到文件末尾（`last_line = total_lines`），确保不回溯历史
- 后续新创建的 rollout 文件：视为新文件，从第 1 行开始扫描（因为文件本身是启用后产生的）

### 4.3 逐行处理

对于每个文件，从 `last_line + 1` 开始逐行读：

- 解析 JSON（失败则跳过、记录错误计数）
- 若命中 `function_call` + `shell_command`：
  - 解析 `payload.arguments`（JSON string）→ 取 `command`、`workdir`
  - 从 `command` 提取 `<skill_key>`
  - 若无法映射到 `~/.codex/skills/**` → 跳过（v1 规则）
  - 否则写入 `skill_usage_events`（并尽量将 `<skill_key>` 关联到 Hub 的 `managed_skill_id`）
- 更新 `codex_scan_cursors.last_line`（建议按批次提交，避免每行写一次 DB）

### 4.4 错误处理

- 单行 JSON 解析失败：跳过该行，不中断扫描
- `payload.arguments` 不是合法 JSON：跳过
- `command` 不包含 `use-skill`：跳过
- `<skill_key>` 无法映射到 `~/.codex/skills/**`：跳过（v1 规则）

---

## 5. 定时扫描、保留期与清空

### 5.1 定时扫描

当 `analytics.codex.enabled=true`：

- App 启动时触发一次增量扫描
- 启动后台 interval：每 `analytics.codex.interval_secs` 扫一次
  - 默认 `300`（5 分钟）
  - 后端强制最小值 `300`（避免过频 IO）

### 5.2 数据保留（默认开启 30 天）

- 设置项：`analytics.retention.enabled=true`、`analytics.retention.days=30`
- 清理策略：不需要每次扫描都清理；建议每 24h（或每次扫描结束做一次“是否到点”的轻量判断）执行：
  - `DELETE FROM skill_usage_events WHERE ts_ms < now_ms - days*86400000`

### 5.3 手动清空

“清空统计数据”应做到：

- 删除 `skill_usage_events`（仅 tool=codex 的数据或全清看 UI 设计）
- 重置 `codex_scan_cursors` 为“从现在开始”：
  - 对现有 rollout 文件，将 `last_line` 设置为文件末尾
  - 避免用户清空后下一轮扫描把历史又重新计入

---

## 6. 前端（Analytics Tab）设计

### 6.1 Analytics 页面结构

- **Codex 使用统计设置**
  - 开关（默认关闭）
  - 扫描周期（默认 5min；提示“建议≥5min”）
  - 项目归一化（默认：git root / 否则 workdir；可切换为“永远 workdir”）
  - 保留期开关 + 天数（默认开启 30 天）
  - “立即扫描”、“清空统计数据”
  - 状态：上次扫描时间、扫描耗时、上次错误

- **排行榜（Leaderboard）**
  - 展示所有被计数的 skills（包含 `.system/*`，并显示 “System” 标签）
  - 列：Skill / 调用次数（24h|7d|All）/ 项目数 / 工具数 / 最近一次使用
  - 支持排序、搜索

- **Skill 详情**
  - 按项目聚合：`project_path` → 调用次数、最近一次时间
  - 可按时间范围过滤

### 6.2 文案与提示（必须写清楚）

在 Analytics 页面固定展示/折叠说明：

- 统计依据：Codex session rollout 日志中出现的 `use-skill <skill_key>`
- v1 不回溯历史：开启统计后仅统计“开启之后新增”的事件
- 只统计能映射到 `~/.codex/skills/**` 的 skills（含 `.system/*`；`superpowers:<name>` 会优先归一化为 `<name>`）
- 项目路径属于敏感信息（若用户导出/截图应注意）

---

## 7. 工作目录（work/）交付物

在仓库根新增 `work/analytics-codex/`：

- `requirements.md`：范围/口径/验收标准
- `backlog.md`：可执行的任务清单（优先级 + 里程碑）
- `progress.md`：开发进度与里程碑记录
- `test-plan.md`：闭环测试清单（手动/自动）
