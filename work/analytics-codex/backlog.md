# Codex 使用统计（Analytics v1）Backlog

## P0 / MVP

- [ ] 新增 SQLite 表：`skill_usage_events`、`codex_scan_cursors`（含迁移）
- [ ] 新增 settings：enabled / interval / project_mode / retention
- [ ] Codex 扫描器：发现 rollout 文件 + 增量解析 + 写入 events + 游标更新
- [ ] 启用时“从现在开始”：为现存文件初始化 EOF 游标（不回溯）
- [ ] 定时任务：启用后每 5min 增量扫描（interval 可配置，后端 clamp ≥5min）
- [ ] 保留期清理：默认开启 30 天（可配置）
- [ ] 清空统计：删除 events + 重置游标到 EOF
- [ ] Tauri commands：读取/更新设置、立即扫描、查询排行榜/详情
- [ ] 前端：新增 Tabs（Skills/Analytics）与 Analytics 页面（设置 + 排行榜 + 详情）
- [ ] 文案：页面提示统计口径与隐私风险

## P1 / 体验增强

- [ ] 排行榜支持按列排序、搜索、分页/虚拟滚动
- [ ] Skill 详情页支持时间范围过滤（24h/7d/all）
- [ ] 扫描状态展示：上次扫描耗时、处理行数、错误行数
- [ ] “导出统计（脱敏）”能力

## P2 / 未来

- [ ] 支持 Claude（hook / 日志采集器）
- [ ] 未托管技能：标记“未托管”，提供导入入口
- [ ] 支持系统/内置技能的单独统计与展示入口
