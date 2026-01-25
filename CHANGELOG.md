# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- GitHub Actions release workflow for macOS packaging and uploading `updater.json` (`.github/workflows/release.yml`).

## [0.1.0] - 2026-01-25

### Added
- Initial release of Skills Hub desktop app (Tauri + React).
- Central repository for Skills; sync to multiple AI coding tools (symlink/junction preferred, copy fallback).
- Local import from folders.
- Git import via repository URL or folder URL (`/tree/<branch>/<path>`), with multi-skill selection and batch install.
- Sync and update: copy-mode targets can be refreshed; managed skills can be updated from source.
- Migration intake: scan existing tool directories, import into central repo, and one‑click sync.
- New tool detection and optional sync.
- Basic settings: storage path, language, and theme.
- Git cache with cleanup (days) and freshness window (seconds).

### Build & Release
- Local packaging scripts for macOS (dmg), Windows (msi/nsis), Linux (deb/appimage).
- GitHub Actions build validation and tag-based draft releases (release notes pulled from `CHANGELOG.md`).

### Performance
- Git import and batch install optimizations: cached clones reduce repeated fetches; timeouts and non‑interactive git improve stability.
