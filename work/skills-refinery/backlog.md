# Skills 修身炉（Skills Refinery）任务清单（按顺序）

## Milestone 0：需求冻结（1 次短迭代）

- [x] 确认点评 Agent 的 provider 路线：API
- [x] 确认新 skill 的默认落点与管理闭环：默认只写 `~/.codex/skills`，可选导入 Hub
- [x] 确认 battle 的定义：默认展示差异，可选引入评价 Agent（名：`待定`）
- [x] 明确 v1 支持的 skill 生态格式：以 `agentskills.io` 标准为准
- [x] 选择首个 API provider（OpenAI）与 Key 存储方式（通过 `.env`/环境变量，不在 App 内录入）
- [x] 确认 work_rule 资产库结构：`~/.work-rules/<name>/` + `manifest.json` + 固定 1 个入口文件

## Milestone 1：Refinery UI（能选能存）

- [x] 增加新 Tab：`Refinery`
- [x] 候选列表：展示 Hub 托管 skills（复用 `get_managed_skills`）
- [x] 候选列表：展示本机已安装 skills（复用/扩展 `onboarding` + `tool_adapters` 扫描）
- [x] 手动导入：支持选择本地文件/文件夹加入会话
- [x] 会话选中区：添加/移除/排序/备注
- [ ] （可选后做）拖拽导入（drag & drop）

### Milestone 1.1：Refinery UX 打磨（测试反馈）

- [ ] 分析弹框：整体宽高增大（桌面端优先），减少“空白但内容挤”的情况
- [ ] 分析弹框：左侧“原文件/源文件”支持折叠/展开（让右侧分析区可放大）
- [ ] 分析弹框：将 `Agent` 下拉、`Run analysis`、`Cancel` 放同一行（节省纵向空间）
- [ ] 行评论：移除 “Add comment” 按钮；点击 `Edit` 即进入编辑态，底部仅保留 `Update/Cancel`
- [ ] 行评论：“+” 改为 hover 显示（避免视觉噪音），且避免 Markdown 嵌套结构产生多个 “+” 叠加
- [ ] 分析结果渲染：确保全量 Markdown 语法（标题/列表/表格/代码块/引用/分隔线等）都有明显样式
- [ ] 分析结果渲染：确保“建议大纲/建议结构”等段落也按 Markdown 正常渲染（不是纯文本）
- [ ] Agent prompt 生效可验证：提供“本次请求使用了哪个 agent.prompt_md / provider.model”的可视化；必要时提供 debug 开关展示请求 payload（用于排查“prompt 不起效”）

### Milestone 1.2：Skills Hub 管理体验（删除/清理）

- [ ] 删除托管 skill：支持在确认弹窗里选择“要清理的工具目标”（多选）；仅对选中的 tool targets 执行清理，其余保留为未托管副本（提示可能产生孤儿文件）

## Milestone 2：Skill Snapshot（只读快照）

- [x] 后端：实现 `get_skill_snapshot`（目录树 + 核心文件文本）
- [x] 前端：可预览快照（SKILL.md / 文件树）
- [x] 安全：路径校验 + 文件大小上限 + 只读

## Milestone 3：本地静态分析（无需 LLM）

- [ ] 相似度：基于 `SKILL.md` 文本做简单相似度（TF-IDF/余弦 或 Jaccard）
- [ ] 结构检查：是否包含“触发条件/步骤/验证/安全限制”等关键段落（lint）
- [ ] 输出 report（JSON）并在 UI 展示（作为 v1 的 fallback）

## Milestone 4：点评 Agent（接入 provider）

- [x] 设计 `ReviewProvider` 接口与数据结构（输入：snapshots + 用户意图；输出：结构化 report）
- [x] 增加设置项：provider 选择 + key/命令路径（存入 `settings`）
- [x] 实现第一个 provider（按 M0 的决定）
- [x] UI：展示 report + 支持用户 review/评论，作为后续优化输入

## Milestone 5：产出新 Skill（Export）

- [x] UI：导出弹窗（name + path，默认 `~/.codex/skills/<name>`）
- [x] 后端：导出 refined skill（生成目录 + 写入 `SKILL.md`）
- [ ] （可选）一键导入 Hub：导出后调用 `install_local` + 选中工具同步

## Milestone 6：测试与文档

- [ ] Rust 单测：snapshot 读取、路径安全、相似度/结构检查
- [ ] E2E 手工用例：从选 skills → 点评 → 导出 全链路
- [ ] 文档：在 `docs/` 补一页“Refinery v1 使用说明”

## Milestone X：工作准则库（Work Rules）

- [x] 后端：work rules root 目录（默认 `~/.work-rules`，可配置）
- [x] 后端：`work_rule` CRUD（create/update/list/delete；tags/score）
- [x] 前端：工作准则页（默认只看 work_rule，支持 type/tags/搜索/排序）
- [x] 导入项目：默认 copy；可选 symlink（带风险提示）
- [x] symlink 失败处理：提示原因，并提供“改用 copy”选项（不自动 fallback）
