# Codex Analytics (v1) Implementation Plan

**Goal:** Add a Codex-only analytics tab that tracks Codex `use-skill` events by scanning `~/.codex/sessions/**/rollout-*.jsonl` and counting only skills that exist under `~/.codex/skills/**` (including `.system/*`).

**Architecture:** Store per-usage events in SQLite (`skill_usage_events`) keyed by `(tool, log_path, log_line)` for idempotent incremental scans. Maintain per-log scan cursors in `codex_scan_cursors`. Frontend owns the interval timer; backend exposes commands for config, scan-now, leaderboard, details, and clear+reset-to-EOF.

**Tech Stack:** Tauri (Rust) + rusqlite + walkdir + git2; React + i18next.

---

### Task 1: SQLite migration (schema v3)

**Files:**
- Modify: `src-tauri/src/core/skill_store.rs`
- Test: `src-tauri/src/core/tests/skill_store.rs`

**Step 1: Write failing migration test**
- Add a test that creates a DB with `user_version=1` and the v1 schema, then calls `ensure_schema()`.
- Expect: `user_version` becomes `3` and new tables exist (`skill_usage_events`, `codex_scan_cursors`).

Run: `cd src-tauri && cargo test core::tests::skill_store -q` (expect FAIL).

**Step 2: Implement migration**
- Bump `SCHEMA_VERSION` to `3`.
- Add migration SQL for v3 tables.
- Update `ensure_schema()` to migrate `user_version == 1` → `3`.

Run: `cd src-tauri && cargo test core::tests::skill_store -q` (expect PASS).

---

### Task 2: Core scanner (parse + incremental scan)

**Files:**
- Create: `src-tauri/src/core/codex_analytics.rs`
- Modify: `src-tauri/src/core/mod.rs`
- Modify: `src-tauri/src/core/skill_store.rs` (store helpers)
- Test: `src-tauri/src/core/tests/codex_analytics.rs`

**Step 1: Write failing parse tests**
- Given a rollout `function_call` line with `shell_command` and `arguments.command` containing `use-skill X`, extract `X`.
- Ensure unrelated lines are ignored.

Run: `cd src-tauri && cargo test codex_analytics -q` (expect FAIL).

**Step 2: Implement minimal parser + scan**
- Walk `~/.codex/sessions/**/rollout-*.jsonl`.
- For each file, resume from cursor line and process new lines.
- Only write events if `~/.codex/skills/<skill_key>` exists (including `.system/*`).
- Insert events idempotently (`UNIQUE(tool, log_path, log_line)`).
- Update cursor to last processed line.

Run: `cd src-tauri && cargo test codex_analytics -q` (expect PASS).

---

### Task 3: Retention + clear/reset-to-EOF

**Files:**
- Modify: `src-tauri/src/core/codex_analytics.rs`
- Modify: `src-tauri/src/core/skill_store.rs`
- Test: `src-tauri/src/core/tests/codex_analytics.rs`

**Step 1: Write failing retention test**
- Insert an “old” event and set retention days to 1.
- Run cleanup; assert old event is deleted.

**Step 2: Write failing clear test**
- Insert events + cursors.
- Call clear; assert events are deleted and cursors set to EOF.

---

### Task 4: Tauri commands (config + scan + queries)

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- (Optional) Test: `src-tauri/src/commands/tests/commands.rs`

**Expose commands:**
- `get_codex_analytics_config`
- `set_codex_analytics_config` (handles enable transition → init cursors to EOF)
- `scan_codex_analytics_now`
- `clear_codex_analytics`
- `get_codex_leaderboard`
- `get_codex_skill_usage_details`

---

### Task 5: Frontend Tabs + Analytics page

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Create: `src/components/analytics/CodexAnalyticsPanel.tsx`
- Modify: `src/i18n/resources.ts`

**Step 1: Tabs**
- Add `Skills` / `Analytics` tabs (default `Skills`).

**Step 2: Analytics page**
- Settings card: enable, interval (clamp ≥ 5min), project mode (git root vs workdir), retention (enabled + days), scan now, clear.
- Leaderboard table with range selector (24h/7d/all), sort by calls.
- Details drawer/section: per-project aggregation.

**Step 3: Timer**
- When enabled, start `setInterval` using config.interval_secs to call `scan_codex_analytics_now`.
- On disable, clear interval.

---

### Task 6: Verification

Run:
- `cd src-tauri && cargo test`
- `npm run lint`
- (Optional) `npm run build`

Manual smoke:
- Enable analytics → verify no backfill (empty counts).
- Trigger `use-skill` in Codex → wait a scan → counts increment.
- Clear → counts reset and do not reappear.
