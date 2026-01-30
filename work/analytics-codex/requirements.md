# Codex 使用统计（Analytics v1）需求

## 背景

Skills Hub 目前能管理/同步 skills，但缺少“哪些 skill 真正在用”的可量化指标。目标是提供本机 Codex 的使用统计，帮助判断常用技能与项目覆盖面，并形成排行榜。

## 范围（v1）

- 仅支持 Codex
- 数据源仅扫描：`~/.codex/sessions/**/rollout-*.jsonl`
- 统计口径：出现 `superpowers-codex use-skill <skill_key>`，并且该 skill 能映射到 `~/.codex/skills/**`（含 `.system/*`）记 1 次
  - 归一化规则：若日志为 `superpowers:<name>` 且 `~/.codex/skills/<name>` 存在，则按 `<name>` 计数
- 项目归一化：默认 git root，否则 workdir（可配置）
- 扫描：定时增量（默认 5min、最小 5min），开关默认关闭
  - 默认不回溯历史：启用后从现有文件 EOF 开始，只统计“启用后新增”的事件
  - 提供“历史回填”：允许用户选择 `~/.codex/sessions/<YYYY>/<MM>/<DD>` 目录多选导入（只影响选中日期对应的 rollout 日志）
- 数据保留：默认开启 30 天，可配置；支持手动清空

## 非目标（v1）

- 不直接统计 `~/.codex/superpowers/skills/**`（不会把 `superpowers:*` 作为独立 skill 维度；仅在能映射到 `~/.codex/skills/<name>` 时计数）
- 不统计 Claude / Cursor 等其它工具
- 不做对话语义推断（只按日志中 `use-skill` 事件计数）
- 不读取 `~/.codex/` 下除 `sessions/**/rollout-*.jsonl` 之外的文件

## 验收标准（v1）

- 开关默认关闭；关闭时不读取任何 Codex 日志
- 打开后默认不回溯历史：只统计开启后的新增事件
- 支持手动“历史回填”：选择日期后可导入历史事件，并可在榜单里通过 range（24h/7d/all）查看
- 增量扫描不重复计数（重复扫描同一日志不增加次数）
- Analytics 页面可看到排行榜（24h/7d/all-time 切换）、项目数、工具数
- 可配置扫描周期（≥5min），可配置保留期天数（默认 30），可手动清空
