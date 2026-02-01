# 更新日志

本文件记录项目的重要变更（中文版本）。

## [Unreleased]

## [0.2.0] - 2026-02-01
### 新增
- 新增多款工具适配与显示（如 Kimi Code CLI、Augment、OpenClaw、Cline、CodeBuddy、Command Code、Continue、Crush、Junie、iFlow CLI、Kiro CLI、Kode、MCPJam、Mistral Vibe、Mux、OpenClaude IDE、OpenHands、Pi、Qoder、Qwen Code、Trae/Trae CN、Zencoder、Neovate、Pochi、AdaL 等）。
- 前端新增共享技能目录提示与联动选择：同一全局 skills 目录的工具勾选/同步/取消同步会一起生效，并弹窗确认。
- 本地导入对齐 Git 规则的 multi-skill 发现，支持批量选择并展示无效项原因。
- 新增本地导入候选列表/按子路径安装的命令，并在安装前校验 SKILL.md。

### 变更
- Antigravity 默认全局技能目录更新为 `~/.gemini/antigravity/global_skills`。
- OpenCode 全局技能目录修正为 `~/.config/opencode/skills`。
- 工具状态接口增加 `skills_dir` 字段，前端列表与同步逻辑改为后端驱动并按目录去重。
- 同一 skills 目录的工具在同步/取消同步时统一写入与清理记录，避免重复文件操作与状态不一致。
- 本地导入流程改为先扫描候选：单个有效候选直接安装，多个候选进入选择列表。

## [0.1.1] - 2026-01-26

### 变更
- GitHub Actions 发版工作流：macOS 打包并上传 `updater.json`（`.github/workflows/release.yml`）。
- Cursor 同步固定使用 Copy：因为 Cursor 在发现 skills 时不会跟随 symlink：https://forum.cursor.com/t/cursor-doesnt-follow-symlinks-to-discover-skills/149693/4
- 托管技能更新时：对 copy 模式目标使用“纯 copy 覆盖回灌”；并对 Cursor 目标强制回灌为 copy，避免误创建软链导致不可用。

## [0.1.0] - 2026-01-24

### 新增
- Skills Hub 桌面应用（Tauri + React）初始发布。
- Skills 中心仓库：统一托管并同步到多种 AI 编程工具（优先 symlink/junction，失败回退 copy）。
- 本地导入：支持从本地文件夹导入 Skill。
- Git 导入：支持仓库 URL/文件夹 URL（`/tree/<branch>/<path>`），支持多 Skill 候选选择与批量安装。
- 同步与更新：copy 模式目标支持回灌更新；托管技能支持从来源更新。
- 迁移接管：扫描工具目录中已有 Skills，导入中心仓库并可一键同步。
- 新工具检测并可选择同步。
- 基础设置：存储路径、界面语言、主题模式。
- Git 缓存：支持按天清理与新鲜期（秒）配置。

### 构建与发布
- 本地打包脚本：macOS（dmg）、Windows（msi/nsis）、Linux（deb/appimage）。
- GitHub Actions 跨平台构建验证与 tag 发布 Draft Release（从 `CHANGELOG.md` 自动提取发布说明）。

### 性能
- Git 导入/批量安装优化：缓存 clone 减少重复拉取；增加超时与无交互提示提升稳定性。
