# Repo Assets (Cheat Sheet)

## Entrypoints

- Frontend: `src/main.tsx` → `src/App.tsx`
- Backend: `src-tauri/src/main.rs` → `src-tauri/src/lib.rs`

## Command Boundary

- Frontend calls backend via `invoke(command,args)` wrapper in `src/App.tsx`
- Backend commands live in `src-tauri/src/commands/mod.rs` and delegate to `src-tauri/src/core/*`

## Core Subsystems

- Central repo path: `src-tauri/src/core/central_repo.rs`
- Import/update skills: `src-tauri/src/core/installer.rs`
- Sync to tools (symlink/junction/copy): `src-tauri/src/core/sync_engine.rs`
- Tool directory rules + discovery: `src-tauri/src/core/tool_adapters/mod.rs`
- Onboarding (scan existing skills): `src-tauri/src/core/onboarding.rs`
- SQLite schema/queries: `src-tauri/src/core/skill_store.rs`

## Recent Feature: Codex Analytics

- Scanner + parsing + normalization: `src-tauri/src/core/codex_analytics.rs`
- UI panel: `src/components/analytics/CodexAnalyticsPanel.tsx`
- Work docs: `work/analytics-codex/`

