#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/src-tauri"

cargo llvm-cov --workspace --html --output-dir "$ROOT_DIR/coverage/llvm-cov"
