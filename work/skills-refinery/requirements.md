# Skills 修身炉（Skills Refinery）需求草案（v1）

## 背景 / 问题

skills 数量膨胀会带来：

- 冗余：大量“看似不同、实则相似”的技能包
- 认知负担：用户难以知道该留哪些/删哪些/如何合并
- 推理干扰：过多 skills 可能导致模型选择/命中质量变差（注意：这是实践假设，需要通过 battle 验证）

## v1 目标（MVP）

1) **选择输入（指令资产采集）**
   - 支持从以下来源把 skill 加入“修身炉会话”：
     - 已托管 skills（Central Repo / Hub 管理的 skills）
     - 已安装 skills（扫描工具目录，比如 `~/.codex/skills/**`）
     - 通过 URL（GitHub repo 或 folder URL）拉取 skill（复用现有 Git 导入/候选选择能力）
     - 项目规范文件（例如 `AGENTS.md`）
   - 交互：支持点击选择；可选支持拖拽（后做）

2) **点评 Agent（Review）**
   - 对选中的 skills 进行结构化点评（输出一份 report）：
     - 相似度/重复度：哪些功能重叠
     - 结构质量：是否有清晰的触发规则、输入输出、工具限制、验证步骤
     - 可维护性：是否可扩展、是否过度冗长、是否包含不安全指令
     - 推荐合并策略：保留哪个为主、哪些段落可抽取复用、建议重命名
   - 同时允许用户补充自己的意见（手动备注/勾选保留项）

3) **产出新资产（Synthesize / Export）**
   - 用户点击“提交/产出”后：
     - 先选择“产出类型”：**Skill（agentskills.io）** 或 **工作规范文件（Work Rules）**
     - 弹出输入框：名称 + 输出路径/落库方式（见下）
     - 生成产物：
       - Skill：生成符合 `agentskills.io` 标准的目录（至少包含 `SKILL.md`）
       - Work Rules：生成一个“固定入口文件”（例如 `AGENTS.md`）+ `manifest.json`
   - 可选：提供“同时导入 Hub（Central Repo）并可同步到其它工具”的开关

## 非目标（v1）

- 不在 v1 做 skills 市场/分享/远程排行榜
- 不执行任何来自 skill/rules 的 scripts（避免 RCE 风险）
- 不做复杂的 prompt 工程 UI（先做固定模板 + 可编辑）
- 不做多模型/多 provider 全覆盖（先落地一个最小可用的 provider 或外部命令适配）

## 关键口径 / 术语

- **修身炉会话（Refinery Session）**：一次选择/点评/产出的工作单元（可保存也可临时）。
- **Asset Snapshot**：对选中资产的“静态快照”，只读取文件与文本内容，不执行。

## 安全与隐私

- 默认不上传本地路径等敏感信息到模型（需要 provider 明确说明）
- 默认不执行任何从 URL 拉取的脚本
- battle 的输入（prompts）可能包含私有内容：需要提示用户谨慎选择/提供“脱敏模式”

## 已确认的决策（v1）

- 点评 Agent：走 API（不走 CLI），首选 OpenAI。
- Key 配置：不在 App 内录入；通过用户预先配置的环境变量（可通过 `.env` 文件加载）提供。
- 产出：默认写入 `~/.work-rules`（作为通用资产库）；再由用户选择导出到具体工具目录（copy/symlink）。
- skill 格式：以 `https://agentskills.io/` 的标准为准。
- 工作准则（work_rule）统一保存目录：`~/.work-rules`（与 `~/.skillshub` 同级）。
- 工作准则（work_rule）资产结构：每条资产固定 1 个“入口文件”（规范正文）；导入项目时可重命名该文件。
- 工作准则导入项目：默认 `copy`；支持 `symlink`（需风险提示）。
  - 若系统/权限不允许创建 symlink：提示原因，并提供“改用 copy”选项让用户决定（不自动 fallback）。

## 仍需确认（为进入实现做准备）

- OpenAI 的环境变量约定：变量名（建议 `OPENAI_API_KEY`）以及 `.env` 的查找位置/优先级（dev/release）。
- “agentskills.io 标准”的具体约束点：必需字段、目录结构、frontmatter/metadata 规则（需要对齐到实现）。
