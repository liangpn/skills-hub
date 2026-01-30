use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::path::PathBuf;

use git2::Repository;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use walkdir::WalkDir;

use crate::core::skill_store::SkillStore;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexUseSkillEvent {
    pub ts_ms: i64,
    pub skill_key: String,
    pub workdir: String,
}

pub fn extract_skill_key_from_command(command: &str) -> Option<String> {
    let mut iter = command.split_whitespace();
    while let Some(token) = iter.next() {
        if token == "use-skill" {
            let skill = iter.next()?;
            return Some(skill.trim_matches(['"', '\'']).to_string());
        }
    }
    None
}

fn parse_timestamp_ms(timestamp: &str) -> Option<i64> {
    let dt = OffsetDateTime::parse(timestamp, &Rfc3339).ok()?;
    Some(dt.unix_timestamp() * 1000 + i64::from(dt.millisecond()))
}

#[derive(Deserialize)]
struct RolloutLine {
    timestamp: Option<String>,
    payload: Option<RolloutPayload>,
}

#[derive(Deserialize)]
struct RolloutPayload {
    #[serde(rename = "type")]
    kind: String,
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Deserialize)]
struct ShellCommandArgs {
    command: Option<String>,
    workdir: Option<String>,
}

pub fn parse_rollout_line_for_use_skill(line: &str) -> Option<CodexUseSkillEvent> {
    let parsed: RolloutLine = serde_json::from_str(line).ok()?;
    let payload = parsed.payload?;
    if payload.kind != "function_call" {
        return None;
    }
    if payload.name.as_deref()? != "shell_command" {
        return None;
    }
    let args_raw = payload.arguments?;
    let args: ShellCommandArgs = serde_json::from_str(&args_raw).ok()?;

    let command = args.command?;
    let skill_key = extract_skill_key_from_command(&command)?;
    let workdir = args.workdir?;
    let ts_ms = parsed
        .timestamp
        .as_deref()
        .and_then(parse_timestamp_ms)
        .unwrap_or(0);
    Some(CodexUseSkillEvent {
        ts_ms,
        skill_key,
        workdir,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectMode {
    GitRootOrWorkdir,
    Workdir,
}

#[derive(Clone, Debug)]
pub struct CodexScanOptions {
    pub sessions_dir: PathBuf,
    pub skills_dir: PathBuf,
    pub now_ms: i64,
    pub project_mode: ProjectMode,
}

#[derive(Clone, Debug, Default)]
pub struct CodexScanStats {
    pub scanned_files: usize,
    pub processed_lines: usize,
    pub new_events: usize,
    pub parse_errors: usize,
    pub matched_use_skill: usize,
    pub skipped_skill_not_found: usize,
    pub duplicate_events: usize,
}

pub fn scan_codex_sessions_dir(
    store: &SkillStore,
    opts: CodexScanOptions,
) -> Result<CodexScanStats> {
    let rollout_logs = collect_rollout_logs(&opts.sessions_dir);
    scan_codex_rollout_logs(store, &opts, rollout_logs)
}

fn scan_codex_rollout_logs(
    store: &SkillStore,
    opts: &CodexScanOptions,
    rollout_logs: Vec<PathBuf>,
) -> Result<CodexScanStats> {
    let mut stats = CodexScanStats::default();

    let mut skill_key_to_id: HashMap<String, String> = HashMap::new();
    for skill in store.list_skills()? {
        skill_key_to_id.insert(skill.name.to_lowercase(), skill.id);
    }

    stats.scanned_files = rollout_logs.len();

    for log_path in rollout_logs {
        let log_path_str = log_path.to_string_lossy().to_string();
        let cursor = store
            .get_codex_scan_cursor_last_line(&log_path_str)?
            .unwrap_or(0);

        let file = match File::open(&log_path) {
            Ok(f) => f,
            Err(_) => {
                stats.parse_errors += 1;
                continue;
            }
        };
        let reader = BufReader::new(file);

        let mut last_line = cursor;
        for (idx, line) in reader.lines().enumerate() {
            let line_no = idx as i64 + 1;
            if line_no <= cursor {
                continue;
            }
            last_line = line_no;
            stats.processed_lines += 1;

            let line = match line {
                Ok(l) => l,
                Err(_) => {
                    stats.parse_errors += 1;
                    continue;
                }
            };
            let Some(event) = parse_rollout_line_for_use_skill(&line) else {
                continue;
            };
            stats.matched_use_skill += 1;

            let Some(skill_key) = canonicalize_codex_skill_key(&opts.skills_dir, &event.skill_key)
            else {
                // Only count skills that exist under `~/.codex/skills/**` (after normalization).
                stats.skipped_skill_not_found += 1;
                continue;
            };

            let managed_skill_id = skill_key_to_id
                .get(&skill_key.to_lowercase())
                .map(|v| v.as_str());

            let ts_ms = if event.ts_ms > 0 {
                event.ts_ms
            } else {
                opts.now_ms
            };

            let project_path = match opts.project_mode {
                ProjectMode::Workdir => event.workdir.clone(),
                ProjectMode::GitRootOrWorkdir => normalize_project_path(&event.workdir),
            };

            let inserted = store.insert_skill_usage_event(
                "codex",
                &skill_key,
                managed_skill_id,
                ts_ms,
                &event.workdir,
                &project_path,
                &log_path_str,
                line_no,
                opts.now_ms,
            )?;
            if inserted {
                stats.new_events += 1;
            } else {
                stats.duplicate_events += 1;
            }
        }

        if last_line > cursor {
            store.upsert_codex_scan_cursor(&log_path_str, last_line, opts.now_ms)?;
        } else if cursor == 0 {
            // Ensure a cursor row exists for an empty new file (best-effort).
            store.upsert_codex_scan_cursor(&log_path_str, 0, opts.now_ms)?;
        }
    }

    Ok(stats)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexSessionDay {
    pub day: String,
    pub files: usize,
}

pub fn list_codex_session_days(sessions_dir: &Path) -> Vec<CodexSessionDay> {
    let mut day_to_files: HashMap<String, usize> = HashMap::new();
    for entry in WalkDir::new(sessions_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !name.starts_with("rollout-") || !name.ends_with(".jsonl") {
            continue;
        }

        let Some(parent) = entry.path().parent() else {
            continue;
        };
        let Ok(rel) = parent.strip_prefix(sessions_dir) else {
            continue;
        };
        let key = rel.to_string_lossy().replace('\\', "/");
        if key.is_empty() {
            continue;
        }

        *day_to_files.entry(key).or_insert(0) += 1;
    }

    let mut days: Vec<CodexSessionDay> = day_to_files
        .into_iter()
        .map(|(day, files)| CodexSessionDay { day, files })
        .collect();
    days.sort_by(|a, b| b.day.cmp(&a.day));
    days
}

pub fn backfill_codex_session_days(
    store: &SkillStore,
    opts: CodexScanOptions,
    selected_days: Vec<String>,
) -> Result<CodexScanStats> {
    let rollout_logs = collect_rollout_logs_for_days(&opts.sessions_dir, &selected_days)?;

    // Force backfill by resetting cursors for selected files.
    for log_path in &rollout_logs {
        let log_path_str = log_path.to_string_lossy().to_string();
        store.upsert_codex_scan_cursor(&log_path_str, 0, opts.now_ms)?;
    }

    scan_codex_rollout_logs(store, &opts, rollout_logs)
}

fn canonicalize_codex_skill_key(skills_dir: &Path, raw_skill_key: &str) -> Option<String> {
    // The Codex skill tool accepts a few forms, e.g.:
    // - brainstorming
    // - .system/skill-installer
    // - superpowers:brainstorming
    // - skills/brainstorming
    //
    // v1 analytics only counts skills that exist under `~/.codex/skills/**`.
    let raw = raw_skill_key.trim_matches(['"', '\'']);
    let raw = raw.strip_prefix("skills/").unwrap_or(raw);

    if is_safe_relative_skill_key(raw) && skills_dir.join(raw).exists() {
        return Some(raw.to_string());
    }

    let Some(rest) = raw.strip_prefix("superpowers:") else {
        return None;
    };
    let rest = rest.strip_prefix("skills/").unwrap_or(rest);
    if is_safe_relative_skill_key(rest) && skills_dir.join(rest).exists() {
        return Some(rest.to_string());
    }

    None
}

fn is_safe_relative_skill_key(skill_key: &str) -> bool {
    is_safe_relative_path(Path::new(skill_key))
}

fn is_safe_relative_path(path: &Path) -> bool {
    if path.is_absolute() {
        return false;
    }
    for component in path.components() {
        if matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::RootDir
        ) {
            return false;
        }
        if matches!(component, std::path::Component::Prefix(_)) {
            return false;
        }
    }
    true
}

#[derive(Clone, Debug, Default)]
pub struct ClearCodexAnalyticsResult {
    pub deleted_events: usize,
}

pub fn cleanup_old_codex_events(
    store: &SkillStore,
    retention_days: i64,
    now_ms: i64,
) -> Result<usize> {
    let retention_days = retention_days.max(0);
    let threshold = now_ms.saturating_sub(retention_days.saturating_mul(86_400_000));
    store.delete_skill_usage_events_before("codex", threshold)
}

pub fn clear_codex_analytics(
    store: &SkillStore,
    sessions_dir: &Path,
    now_ms: i64,
) -> Result<ClearCodexAnalyticsResult> {
    let deleted_events = store.delete_skill_usage_events_for_tool("codex")?;

    set_codex_cursors_to_eof(store, sessions_dir, now_ms)?;

    Ok(ClearCodexAnalyticsResult { deleted_events })
}

pub fn set_codex_cursors_to_eof(
    store: &SkillStore,
    sessions_dir: &Path,
    now_ms: i64,
) -> Result<()> {
    store.clear_codex_scan_cursors()?;
    for log_path in collect_rollout_logs(sessions_dir) {
        let last_line = count_lines(&log_path).unwrap_or(0);
        store.upsert_codex_scan_cursor(&log_path.to_string_lossy(), last_line, now_ms)?;
    }
    Ok(())
}

fn normalize_project_path(workdir: &str) -> String {
    let Ok(repo) = Repository::discover(workdir) else {
        return workdir.to_string();
    };

    if let Some(root) = repo.workdir() {
        return root.to_string_lossy().to_string();
    }

    // Fallback: `repo.path()` is usually `<root>/.git`
    let git_dir = repo.path();
    git_dir
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| workdir.to_string())
}

fn collect_rollout_logs(sessions_dir: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for entry in WalkDir::new(sessions_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !name.starts_with("rollout-") || !name.ends_with(".jsonl") {
            continue;
        }
        paths.push(entry.path().to_path_buf());
    }
    paths.sort();
    paths
}

fn collect_rollout_logs_for_days(
    sessions_dir: &Path,
    selected_days: &[String],
) -> Result<Vec<PathBuf>> {
    let mut logs = Vec::new();

    for day in selected_days {
        let rel = Path::new(day);
        if !is_safe_relative_path(rel) {
            anyhow::bail!("invalid day path: {}", day);
        }
        if day.trim().is_empty() {
            continue;
        }

        let day_dir = sessions_dir.join(rel);
        if !day_dir.exists() {
            continue;
        }

        for entry in WalkDir::new(day_dir)
            .follow_links(false)
            .max_depth(2)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy();
            if !name.starts_with("rollout-") || !name.ends_with(".jsonl") {
                continue;
            }
            logs.push(entry.path().to_path_buf());
        }
    }

    logs.sort();
    logs.dedup();
    Ok(logs)
}

fn count_lines(path: &Path) -> std::io::Result<i64> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut count: i64 = 0;
    for line in reader.lines() {
        line?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
#[path = "tests/codex_analytics.rs"]
mod tests;
