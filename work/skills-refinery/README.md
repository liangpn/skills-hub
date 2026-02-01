# Skills 修身炉（Skills Refinery）

本目录记录“Skills 修身炉（Skills Refinery）”功能的需求、设计与开发任务拆解（WIP）。

目标：在 Skills Hub 现有“集中管理 + 同步到多工具”的基础上，新增一个工作台：

- 从已安装/已托管/URL 获取 skills
- 让一个“点评 Agent”对选中 skills 做结构化审查（冗余/相似/更优实践等）
- 基于点评 + 用户选择，产出一个新的 skill（可导出到 `~/.codex/skills` 或导入 Hub）
- 支持把多份“指令资产”（skills / 项目规范）提炼成一份更精炼的产物

文件说明：

- `requirements.md`：范围、口径、非目标、开放问题
- `design.md`：架构方案（前后端 + 数据模型 + 安全）
- `backlog.md`：按顺序的任务清单（可执行）
- `test-plan.md`：闭环验证用例
