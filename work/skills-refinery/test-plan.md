# Skills 修身炉（Skills Refinery）闭环测试计划（草案）

## 用例 1：从 Hub 托管 skills 加入会话

1. 打开 Refinery Tab
2. 在“Hub skills”列表选择 2 个 skills
3. 预期：会话区出现 2 条，顺序可调整，备注可编辑

## 用例 2：从本机已安装 skills 加入会话

1. 切换到“Installed skills”来源（例如 Codex）
2. 选择 1 个已安装 skill
3. 预期：会话区出现该 skill，能显示来源路径

## 用例 3：URL 导入候选加入会话

1. 输入 Git URL（支持 repo / folder URL）
2. 选择一个候选 skill
3. 预期：会话区出现该 skill（此时不应写入 `~/.codex/skills`）

## 用例 4：生成 Snapshot 并预览

1. 对会话中的某个 skill 点击“预览”
2. 预期：显示文件树 + `SKILL.md` 内容（超大文件应提示/截断）

## 用例 5：生成点评报告

1. 点击“生成点评”
2. 预期：report 出现在右侧；至少包含“相似/冗余/建议合并”字段

## 用例 6：导出新 skill

1. 点击“导出”
2. 输入 name（例如 `my-refined-skill`），保持默认路径 `~/.codex/skills`
3. 预期：目标目录生成；至少包含 `SKILL.md`；再次导出同名应提示冲突
