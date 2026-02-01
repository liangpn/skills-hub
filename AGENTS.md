# Skills Hub — Agent Notes

This repo is a Tauri desktop app (Rust backend + React frontend) for managing Agent Skills and syncing them into multiple tools’ global skills directories.

## Quick Start

- Dev: `npm run tauri:dev`
- Frontend: `npm run lint` / `npm run build`
- Rust tests: `cd src-tauri && cargo test`

## Repo Map (read first)

- Deep dive report: `docs/repo_review.md`
- System design: `docs/system-design.md` / `docs/system-design.zh.md`
- Cheat sheet: `AGENT_ASSETS.md`

## Where To Change Things

- Frontend entry: `src/App.tsx`
- Tauri entry + command registration: `src-tauri/src/lib.rs`
- Tauri commands (frontend invoke API): `src-tauri/src/commands/mod.rs`
- Core modules (business logic): `src-tauri/src/core/*`
- SQLite schema + queries: `src-tauri/src/core/skill_store.rs`
- Tool adapters (skills dir rules): `src-tauri/src/core/tool_adapters/mod.rs`

## Work Notes Convention

Put WIP specs/design/backlog in `work/<feature>/` (then promote to `docs/` when stable).

