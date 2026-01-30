# Codex 使用统计（Analytics v1）进度记录

## 里程碑

- M0：需求与设计确认
- M1：后端数据层（表 + 迁移 + 扫描器 + 定时/清理）
- M2：前端 Analytics 页面（Tabs + 榜单 + 详情 + 设置）
- M3：闭环测试通过（覆盖增量、去重、清空、保留期）

## 日志

### 2026-01-28

- ✅ 需求口径确认：仅 Codex、仅 `~/.codex/skills/**`（含 `.system/*`）、只扫 `~/.codex/sessions/**/rollout-*.jsonl`
- ✅ 不回溯历史：启用时设置游标为 EOF
- ✅ 扫描周期默认 5min、最小 5min
- ✅ 保留期默认开启 30 天 + 支持手动清空
- ✅ 后端：SQLite v3 迁移（usage events + cursors）
- ✅ 后端：扫描器（增量/幂等、git root 归一化、`.system/*` 标记为系统技能）
- ✅ 后端：Tauri commands（config/scan/clear/leaderboard/details）
- ✅ 前端：Tabs（Skills/Analytics）+ Codex Analytics 页面（设置 + 榜单 + 详情）
