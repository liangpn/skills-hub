use anyhow::Context;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::cache_cleanup::{
    cleanup_git_cache_dirs, get_git_cache_cleanup_days as get_git_cache_cleanup_days_core,
    get_git_cache_ttl_secs as get_git_cache_ttl_secs_core,
    set_git_cache_cleanup_days as set_git_cache_cleanup_days_core,
    set_git_cache_ttl_secs as set_git_cache_ttl_secs_core,
};
use crate::core::central_repo::{ensure_central_repo, resolve_central_repo_path};
use crate::core::codex_analytics::{
    backfill_codex_session_days as backfill_codex_session_days_core,
    cleanup_old_codex_events as cleanup_old_codex_events_core,
    clear_codex_analytics as clear_codex_analytics_core, scan_codex_sessions_dir,
    list_codex_session_days as list_codex_session_days_core, set_codex_cursors_to_eof,
    CodexScanOptions, CodexScanStats, CodexSessionDay, ProjectMode,
};
use crate::core::github_search::{search_github_repos, RepoSummary};
use crate::core::installer::{
    install_git_skill, install_git_skill_from_selection, install_local_skill, list_git_skills,
    update_managed_skill_from_source, GitSkillCandidate, InstallResult,
};
use crate::core::onboarding::{build_onboarding_plan, OnboardingPlan};
use crate::core::skill_store::{
    SkillStore, SkillTargetRecord, SkillUsageLeaderboardRow, SkillUsageProjectRow,
};
use crate::core::sync_engine::{
    copy_dir_recursive, sync_dir_for_tool_with_overwrite, sync_dir_hybrid, SyncMode,
};
use crate::core::tool_adapters::{adapter_by_key, is_tool_installed, resolve_default_path};
use uuid::Uuid;

fn format_anyhow_error(err: anyhow::Error) -> String {
    let first = err.to_string();
    // Frontend relies on these prefixes for special flows.
    if first.starts_with("MULTI_SKILLS|")
        || first.starts_with("TARGET_EXISTS|")
        || first.starts_with("TOOL_NOT_INSTALLED|")
    {
        return first;
    }

    // Include the full error chain (causes), not just the top context.
    let mut full = format!("{:#}", err);

    // Redact noisy temp paths from clone context (we care about the cause, not the dest).
    // Example: `clone https://... into "/Users/.../skills-hub-git-<uuid>"`
    if let Some(head) = full.lines().next() {
        if head.starts_with("clone ") {
            if let Some(pos) = head.find(" into ") {
                let head_redacted = format!("{} (已省略临时目录)", &head[..pos]);
                let rest: String = full.lines().skip(1).collect::<Vec<_>>().join("\n");
                full = if rest.is_empty() {
                    head_redacted
                } else {
                    format!("{}\n{}", head_redacted, rest)
                };
            }
        }
    }

    let root = err.root_cause().to_string();
    let lower = full.to_lowercase();

    // Heuristic-friendly messaging for GitHub clone failures.
    if lower.contains("github.com")
        && (lower.contains("clone ") || lower.contains("remote") || lower.contains("fetch"))
    {
        if lower.contains("securetransport") {
            return format!(
        "无法从 GitHub 拉取仓库：TLS/证书校验失败（macOS SecureTransport）。\n\n建议：\n- 检查网络/代理是否拦截 HTTPS\n- 如在公司网络，可能需要安装公司根证书或使用可信代理\n- 也可在终端确认 `git clone {}` 是否可用\n\n详细：{}",
        "https://github.com/<owner>/<repo>",
        root
      );
        }
        let hint = if lower.contains("authentication")
            || lower.contains("permission denied")
            || lower.contains("credentials")
        {
            "无法访问该仓库：可能是私有仓库/权限不足/需要鉴权。"
        } else if lower.contains("not found") {
            "仓库不存在或无权限访问（GitHub 返回 not found）。"
        } else if lower.contains("failed to resolve")
            || lower.contains("could not resolve")
            || lower.contains("dns")
        {
            "无法解析 GitHub 域名（DNS）。请检查网络/代理。"
        } else if lower.contains("timed out") || lower.contains("timeout") {
            "连接 GitHub 超时。请检查网络/代理。"
        } else if lower.contains("connection refused") || lower.contains("connection reset") {
            "连接 GitHub 失败（连接被拒绝/重置）。请检查网络/代理。"
        } else {
            "无法从 GitHub 拉取仓库。请检查网络/代理，或稍后重试。"
        };

        return format!("{}\n\n详细：{}", hint, root);
    }

    full
}

#[derive(Debug, Serialize)]
pub struct ToolInfoDto {
    pub key: String,
    pub label: String,
    pub installed: bool,
}

#[derive(Debug, Serialize)]
pub struct ToolStatusDto {
    pub tools: Vec<ToolInfoDto>,
    pub installed: Vec<String>,
    pub newly_installed: Vec<String>,
}

const ANALYTICS_CODEX_ENABLED_KEY: &str = "analytics_codex_enabled";
const ANALYTICS_CODEX_INTERVAL_SECS_KEY: &str = "analytics_codex_interval_secs";
const ANALYTICS_CODEX_PROJECT_MODE_KEY: &str = "analytics_codex_project_mode";
const ANALYTICS_RETENTION_ENABLED_KEY: &str = "analytics_retention_enabled";
const ANALYTICS_RETENTION_DAYS_KEY: &str = "analytics_retention_days";
const ANALYTICS_CODEX_LAST_SCAN_MS_KEY: &str = "analytics_codex_last_scan_ms";

const DEFAULT_ANALYTICS_CODEX_ENABLED: bool = false;
const DEFAULT_ANALYTICS_CODEX_INTERVAL_SECS: i64 = 300;
const MIN_ANALYTICS_CODEX_INTERVAL_SECS: i64 = 300;
const MAX_ANALYTICS_CODEX_INTERVAL_SECS: i64 = 86_400; // 24h
const DEFAULT_ANALYTICS_CODEX_PROJECT_MODE: &str = "git_root_or_workdir";
const DEFAULT_ANALYTICS_RETENTION_ENABLED: bool = true;
const DEFAULT_ANALYTICS_RETENTION_DAYS: i64 = 30;
const MAX_ANALYTICS_RETENTION_DAYS: i64 = 3650;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAnalyticsConfigDto {
    pub enabled: bool,
    pub interval_secs: i64,
    pub project_mode: String,
    pub retention_enabled: bool,
    pub retention_days: i64,
    pub last_scan_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexScanStatsDto {
    pub scanned_files: usize,
    pub processed_lines: usize,
    pub new_events: usize,
    pub parse_errors: usize,
    pub matched_use_skill: usize,
    pub skipped_skill_not_found: usize,
    pub duplicate_events: usize,
    pub retention_deleted: usize,
    pub now_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexSessionDayDto {
    pub day: String,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClearCodexAnalyticsResultDto {
    pub deleted_events: usize,
    pub now_ms: i64,
}

fn parse_bool(raw: Option<String>) -> Option<bool> {
    let v = raw?.trim().to_lowercase();
    match v.as_str() {
        "true" | "1" | "yes" | "y" => Some(true),
        "false" | "0" | "no" | "n" => Some(false),
        _ => None,
    }
}

fn parse_i64(raw: Option<String>) -> Option<i64> {
    raw?.trim().parse::<i64>().ok()
}

fn normalize_codex_project_mode(raw: Option<String>) -> String {
    match raw.as_deref().map(|s| s.trim()) {
        Some("workdir") => "workdir".to_string(),
        Some("git_root_or_workdir") => "git_root_or_workdir".to_string(),
        _ => DEFAULT_ANALYTICS_CODEX_PROJECT_MODE.to_string(),
    }
}

fn project_mode_to_core(mode: &str) -> ProjectMode {
    match mode {
        "workdir" => ProjectMode::Workdir,
        _ => ProjectMode::GitRootOrWorkdir,
    }
}

fn resolve_codex_sessions_dir() -> Result<std::path::PathBuf, anyhow::Error> {
    let home = dirs::home_dir().context("failed to resolve home directory")?;
    Ok(home.join(".codex").join("sessions"))
}

fn resolve_codex_skills_dir() -> Result<std::path::PathBuf, anyhow::Error> {
    let home = dirs::home_dir().context("failed to resolve home directory")?;
    Ok(home.join(".codex").join("skills"))
}

fn get_codex_analytics_config_impl(store: &SkillStore) -> CodexAnalyticsConfigDto {
    let enabled = parse_bool(
        store
            .get_setting(ANALYTICS_CODEX_ENABLED_KEY)
            .ok()
            .flatten(),
    )
    .unwrap_or(DEFAULT_ANALYTICS_CODEX_ENABLED);

    let interval_secs = parse_i64(
        store
            .get_setting(ANALYTICS_CODEX_INTERVAL_SECS_KEY)
            .ok()
            .flatten(),
    )
    .unwrap_or(DEFAULT_ANALYTICS_CODEX_INTERVAL_SECS)
    .clamp(
        MIN_ANALYTICS_CODEX_INTERVAL_SECS,
        MAX_ANALYTICS_CODEX_INTERVAL_SECS,
    );

    let project_mode = normalize_codex_project_mode(
        store
            .get_setting(ANALYTICS_CODEX_PROJECT_MODE_KEY)
            .ok()
            .flatten(),
    );

    let retention_enabled = parse_bool(
        store
            .get_setting(ANALYTICS_RETENTION_ENABLED_KEY)
            .ok()
            .flatten(),
    )
    .unwrap_or(DEFAULT_ANALYTICS_RETENTION_ENABLED);

    let retention_days = parse_i64(
        store
            .get_setting(ANALYTICS_RETENTION_DAYS_KEY)
            .ok()
            .flatten(),
    )
    .unwrap_or(DEFAULT_ANALYTICS_RETENTION_DAYS)
    .clamp(0, MAX_ANALYTICS_RETENTION_DAYS);

    let last_scan_ms = parse_i64(
        store
            .get_setting(ANALYTICS_CODEX_LAST_SCAN_MS_KEY)
            .ok()
            .flatten(),
    );

    CodexAnalyticsConfigDto {
        enabled,
        interval_secs,
        project_mode,
        retention_enabled,
        retention_days,
        last_scan_ms,
    }
}

#[tauri::command]
pub async fn get_tool_status(store: State<'_, SkillStore>) -> Result<ToolStatusDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let adapters = crate::core::tool_adapters::default_tool_adapters();
        let mut tools: Vec<ToolInfoDto> = Vec::new();
        let mut installed: Vec<String> = Vec::new();

        for adapter in &adapters {
            let ok = is_tool_installed(adapter)?;
            let key = adapter.id.as_key().to_string();
            tools.push(ToolInfoDto {
                key: key.clone(),
                label: adapter.display_name.to_string(),
                installed: ok,
            });
            if ok {
                installed.push(key);
            }
        }

        installed.dedup();

        let prev: Vec<String> = store
            .get_setting("installed_tools_v1")?
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default();

        let prev_set: std::collections::HashSet<String> = prev.into_iter().collect();
        let newly_installed: Vec<String> = installed
            .iter()
            .filter(|k| !prev_set.contains(*k))
            .cloned()
            .collect();

        // Persist current set (best effort).
        let _ = store.set_setting(
            "installed_tools_v1",
            &serde_json::to_string(&installed).unwrap_or_else(|_| "[]".to_string()),
        );

        Ok::<_, anyhow::Error>(ToolStatusDto {
            tools,
            installed,
            newly_installed,
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn get_onboarding_plan(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
) -> Result<OnboardingPlan, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || build_onboarding_plan(&app, &store))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn get_git_cache_cleanup_days(store: State<'_, SkillStore>) -> Result<i64, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, anyhow::Error>(get_git_cache_cleanup_days_core(&store))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn set_git_cache_cleanup_days(
    store: State<'_, SkillStore>,
    days: i64,
) -> Result<i64, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || set_git_cache_cleanup_days_core(&store, days))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn clear_git_cache_now(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cleanup_git_cache_dirs(&app, std::time::Duration::from_secs(0))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn get_codex_analytics_config(
    store: State<'_, SkillStore>,
) -> Result<CodexAnalyticsConfigDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, anyhow::Error>(get_codex_analytics_config_impl(&store))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn set_codex_analytics_config(
    store: State<'_, SkillStore>,
    config: CodexAnalyticsConfigDto,
) -> Result<CodexAnalyticsConfigDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let prev = get_codex_analytics_config_impl(&store);

        let normalized = CodexAnalyticsConfigDto {
            enabled: config.enabled,
            interval_secs: config.interval_secs.clamp(
                MIN_ANALYTICS_CODEX_INTERVAL_SECS,
                MAX_ANALYTICS_CODEX_INTERVAL_SECS,
            ),
            project_mode: normalize_codex_project_mode(Some(config.project_mode)),
            retention_enabled: config.retention_enabled,
            retention_days: config.retention_days.clamp(0, MAX_ANALYTICS_RETENTION_DAYS),
            last_scan_ms: prev.last_scan_ms,
        };

        store.set_setting(
            ANALYTICS_CODEX_ENABLED_KEY,
            if normalized.enabled { "true" } else { "false" },
        )?;
        store.set_setting(
            ANALYTICS_CODEX_INTERVAL_SECS_KEY,
            &normalized.interval_secs.to_string(),
        )?;
        store.set_setting(
            ANALYTICS_CODEX_PROJECT_MODE_KEY,
            normalized.project_mode.as_str(),
        )?;
        store.set_setting(
            ANALYTICS_RETENTION_ENABLED_KEY,
            if normalized.retention_enabled {
                "true"
            } else {
                "false"
            },
        )?;
        store.set_setting(
            ANALYTICS_RETENTION_DAYS_KEY,
            &normalized.retention_days.to_string(),
        )?;

        if !prev.enabled && normalized.enabled {
            let sessions_dir = resolve_codex_sessions_dir()?;
            set_codex_cursors_to_eof(&store, &sessions_dir, now_ms())?;
        }

        Ok::<_, anyhow::Error>(normalized)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn scan_codex_analytics_now(
    store: State<'_, SkillStore>,
) -> Result<CodexScanStatsDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = get_codex_analytics_config_impl(&store);
        let now_ms = now_ms();

        if !config.enabled {
            return Ok::<_, anyhow::Error>(CodexScanStatsDto {
                scanned_files: 0,
                processed_lines: 0,
                new_events: 0,
                parse_errors: 0,
                matched_use_skill: 0,
                skipped_skill_not_found: 0,
                duplicate_events: 0,
                retention_deleted: 0,
                now_ms,
            });
        }

        let sessions_dir = resolve_codex_sessions_dir()?;
        let skills_dir = resolve_codex_skills_dir()?;
        let stats: CodexScanStats = scan_codex_sessions_dir(
            &store,
            CodexScanOptions {
                sessions_dir,
                skills_dir,
                now_ms,
                project_mode: project_mode_to_core(&config.project_mode),
            },
        )?;

        let retention_deleted = if config.retention_enabled {
            cleanup_old_codex_events_core(&store, config.retention_days, now_ms)?
        } else {
            0
        };

        // Best-effort: track last scan time for UI.
        let _ = store.set_setting(ANALYTICS_CODEX_LAST_SCAN_MS_KEY, &now_ms.to_string());

        Ok::<_, anyhow::Error>(CodexScanStatsDto {
            scanned_files: stats.scanned_files,
            processed_lines: stats.processed_lines,
            new_events: stats.new_events,
            parse_errors: stats.parse_errors,
            matched_use_skill: stats.matched_use_skill,
            skipped_skill_not_found: stats.skipped_skill_not_found,
            duplicate_events: stats.duplicate_events,
            retention_deleted,
            now_ms,
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn list_codex_session_days(
    store: State<'_, SkillStore>,
) -> Result<Vec<CodexSessionDayDto>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = get_codex_analytics_config_impl(&store);
        if !config.enabled {
            anyhow::bail!("analytics is disabled");
        }

        let sessions_dir = resolve_codex_sessions_dir()?;
        let items: Vec<CodexSessionDay> = list_codex_session_days_core(&sessions_dir);
        Ok::<_, anyhow::Error>(
            items
                .into_iter()
                .map(|d| CodexSessionDayDto {
                    day: d.day,
                    files: d.files,
                })
                .collect(),
        )
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn backfill_codex_analytics(
    store: State<'_, SkillStore>,
    days: Vec<String>,
) -> Result<CodexScanStatsDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = get_codex_analytics_config_impl(&store);
        let now_ms = now_ms();

        if !config.enabled {
            anyhow::bail!("analytics is disabled");
        }

        let sessions_dir = resolve_codex_sessions_dir()?;
        let skills_dir = resolve_codex_skills_dir()?;
        let stats: CodexScanStats = backfill_codex_session_days_core(
            &store,
            CodexScanOptions {
                sessions_dir,
                skills_dir,
                now_ms,
                project_mode: project_mode_to_core(&config.project_mode),
            },
            days,
        )?;

        let retention_deleted = if config.retention_enabled {
            cleanup_old_codex_events_core(&store, config.retention_days, now_ms)?
        } else {
            0
        };

        // Best-effort: track last scan time for UI.
        let _ = store.set_setting(ANALYTICS_CODEX_LAST_SCAN_MS_KEY, &now_ms.to_string());

        Ok::<_, anyhow::Error>(CodexScanStatsDto {
            scanned_files: stats.scanned_files,
            processed_lines: stats.processed_lines,
            new_events: stats.new_events,
            parse_errors: stats.parse_errors,
            matched_use_skill: stats.matched_use_skill,
            skipped_skill_not_found: stats.skipped_skill_not_found,
            duplicate_events: stats.duplicate_events,
            retention_deleted,
            now_ms,
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn clear_codex_analytics(
    store: State<'_, SkillStore>,
) -> Result<ClearCodexAnalyticsResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now_ms = now_ms();
        let sessions_dir = resolve_codex_sessions_dir()?;
        let cleared = clear_codex_analytics_core(&store, &sessions_dir, now_ms)?;
        let _ = store.set_setting(ANALYTICS_CODEX_LAST_SCAN_MS_KEY, &now_ms.to_string());
        Ok::<_, anyhow::Error>(ClearCodexAnalyticsResultDto {
            deleted_events: cleared.deleted_events,
            now_ms,
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_codex_leaderboard(
    store: State<'_, SkillStore>,
    sinceMs: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<SkillUsageLeaderboardRow>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let limit = limit.unwrap_or(50).clamp(0, 500);
        Ok::<_, anyhow::Error>(store.get_skill_usage_leaderboard("codex", sinceMs, limit)?)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_codex_skill_usage_details(
    store: State<'_, SkillStore>,
    skillId: String,
    sinceMs: Option<i64>,
) -> Result<Vec<SkillUsageProjectRow>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, anyhow::Error>(store.get_skill_usage_by_project("codex", &skillId, sinceMs)?)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn get_git_cache_ttl_secs(store: State<'_, SkillStore>) -> Result<i64, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, anyhow::Error>(get_git_cache_ttl_secs_core(&store))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn set_git_cache_ttl_secs(
    store: State<'_, SkillStore>,
    secs: i64,
) -> Result<i64, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || set_git_cache_ttl_secs_core(&store, secs))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[derive(Debug, Serialize)]
pub struct InstallResultDto {
    pub skill_id: String,
    pub name: String,
    pub central_path: String,
    pub content_hash: Option<String>,
}

fn expand_home_path(input: &str) -> Result<std::path::PathBuf, anyhow::Error> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        anyhow::bail!("storage path is empty");
    }
    if trimmed == "~" {
        let home = dirs::home_dir().context("failed to resolve home directory")?;
        return Ok(home);
    }
    if let Some(stripped) = trimmed.strip_prefix("~/") {
        let home = dirs::home_dir().context("failed to resolve home directory")?;
        return Ok(home.join(stripped));
    }
    Ok(std::path::PathBuf::from(trimmed))
}

#[tauri::command]
pub async fn get_central_repo_path(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
) -> Result<String, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_central_repo_path(&app, &store)?;
        ensure_central_repo(&path)?;
        Ok::<_, anyhow::Error>(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn set_central_repo_path(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    path: String,
) -> Result<String, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let new_base = expand_home_path(&path)?;
        if !new_base.is_absolute() {
            anyhow::bail!("storage path must be absolute");
        }
        ensure_central_repo(&new_base)?;

        let current_base = resolve_central_repo_path(&app, &store)?;
        let skills = store.list_skills()?;
        if current_base == new_base {
            store.set_setting("central_repo_path", new_base.to_string_lossy().as_ref())?;
            return Ok::<_, anyhow::Error>(new_base.to_string_lossy().to_string());
        }

        if !skills.is_empty() {
            for skill in skills {
                let old_path = std::path::PathBuf::from(&skill.central_path);
                if !old_path.exists() {
                    anyhow::bail!("central path not found: {:?}", old_path);
                }
                let file_name = old_path
                    .file_name()
                    .ok_or_else(|| anyhow::anyhow!("invalid central path: {:?}", old_path))?;
                let new_path = new_base.join(file_name);
                if new_path.exists() {
                    anyhow::bail!("target path already exists: {:?}", new_path);
                }

                if let Err(err) = std::fs::rename(&old_path, &new_path) {
                    copy_dir_recursive(&old_path, &new_path)
                        .with_context(|| format!("copy {:?} -> {:?}", old_path, new_path))?;
                    std::fs::remove_dir_all(&old_path)
                        .with_context(|| format!("cleanup {:?}", old_path))?;
                    // Surface rename error in logs for troubleshooting.
                    eprintln!("rename failed, fallback used: {}", err);
                }

                let mut updated = skill.clone();
                updated.central_path = new_path.to_string_lossy().to_string();
                updated.updated_at = now_ms();
                store.upsert_skill(&updated)?;
            }
        }

        store.set_setting("central_repo_path", new_base.to_string_lossy().as_ref())?;
        Ok::<_, anyhow::Error>(new_base.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn install_local(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    sourcePath: String,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = install_local_skill(&app, &store, sourcePath.as_ref(), name)?;
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn install_git(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    repoUrl: String,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = install_git_skill(&app, &store, &repoUrl, name)?;
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn list_git_skills_cmd(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    repoUrl: String,
) -> Result<Vec<GitSkillCandidate>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || list_git_skills(&app, &store, &repoUrl))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn install_git_selection(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    repoUrl: String,
    subpath: String,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = install_git_skill_from_selection(&app, &store, &repoUrl, &subpath, name)?;
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[derive(Debug, Serialize)]
pub struct SyncResultDto {
    pub mode_used: String,
    pub target_path: String,
}

#[tauri::command]
pub async fn sync_skill_dir(
    source_path: String,
    target_path: String,
) -> Result<SyncResultDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = sync_dir_hybrid(source_path.as_ref(), target_path.as_ref())?;
        Ok::<_, anyhow::Error>(SyncResultDto {
            mode_used: match result.mode_used {
                SyncMode::Auto => "auto",
                SyncMode::Symlink => "symlink",
                SyncMode::Junction => "junction",
                SyncMode::Copy => "copy",
            }
            .to_string(),
            target_path: result.target_path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn sync_skill_to_tool(
    store: State<'_, SkillStore>,
    sourcePath: String,
    skillId: String,
    tool: String,
    name: String,
    overwrite: Option<bool>,
) -> Result<SyncResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let adapter = adapter_by_key(&tool).ok_or_else(|| anyhow::anyhow!("unknown tool"))?;
        if !is_tool_installed(&adapter)? {
            anyhow::bail!("TOOL_NOT_INSTALLED|{}", adapter.id.as_key());
        }
        let tool_root = resolve_default_path(&adapter)?;
        let target = tool_root.join(&name);
        let overwrite = overwrite.unwrap_or(false);
        let result =
            sync_dir_for_tool_with_overwrite(&tool, sourcePath.as_ref(), &target, overwrite)
                .map_err(|err| {
                    let msg = err.to_string();
                    if msg.contains("target already exists") {
                        anyhow::anyhow!("TARGET_EXISTS|{}", target.to_string_lossy())
                    } else {
                        anyhow::anyhow!(msg)
                    }
                })?;

        let record = SkillTargetRecord {
            id: Uuid::new_v4().to_string(),
            skill_id: skillId,
            tool,
            target_path: result.target_path.to_string_lossy().to_string(),
            mode: match result.mode_used {
                SyncMode::Auto => "auto",
                SyncMode::Symlink => "symlink",
                SyncMode::Junction => "junction",
                SyncMode::Copy => "copy",
            }
            .to_string(),
            status: "ok".to_string(),
            last_error: None,
            synced_at: Some(now_ms()),
        };
        store.upsert_skill_target(&record)?;

        Ok::<_, anyhow::Error>(SyncResultDto {
            mode_used: match result.mode_used {
                SyncMode::Auto => "auto",
                SyncMode::Symlink => "symlink",
                SyncMode::Junction => "junction",
                SyncMode::Copy => "copy",
            }
            .to_string(),
            target_path: result.target_path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn unsync_skill_from_tool(
    store: State<'_, SkillStore>,
    skillId: String,
    tool: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // If the tool is not installed, do nothing (treat as already not effective).
        if let Some(adapter) = adapter_by_key(&tool) {
            if !is_tool_installed(&adapter)? {
                return Ok::<_, anyhow::Error>(());
            }
        }

        if let Some(target) = store.get_skill_target(&skillId, &tool)? {
            // Remove the link/copy in tool directory first, then delete DB record.
            remove_path_any(&target.target_path).map_err(anyhow::Error::msg)?;
            store.delete_skill_target(&skillId, &tool)?;
        }

        Ok::<_, anyhow::Error>(())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[derive(Debug, Serialize)]
pub struct UpdateResultDto {
    pub skill_id: String,
    pub name: String,
    pub content_hash: Option<String>,
    pub source_revision: Option<String>,
    pub updated_targets: Vec<String>,
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn update_managed_skill(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    skillId: String,
) -> Result<UpdateResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let res = update_managed_skill_from_source(&app, &store, &skillId)?;
        Ok::<_, anyhow::Error>(UpdateResultDto {
            skill_id: res.skill_id,
            name: res.name,
            content_hash: res.content_hash,
            source_revision: res.source_revision,
            updated_targets: res.updated_targets,
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn search_github(query: String, limit: Option<u32>) -> Result<Vec<RepoSummary>, String> {
    let limit = limit.unwrap_or(10) as usize;
    tauri::async_runtime::spawn_blocking(move || search_github_repos(&query, limit))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn import_existing_skill(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    sourcePath: String,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = install_local_skill(&app, &store, sourcePath.as_ref(), name)?;
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[derive(Debug, Serialize)]
pub struct ManagedSkillDto {
    pub id: String,
    pub name: String,
    pub source_type: String,
    pub source_ref: Option<String>,
    pub central_path: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_sync_at: Option<i64>,
    pub status: String,
    pub targets: Vec<SkillTargetDto>,
}

#[derive(Debug, Serialize)]
pub struct SkillTargetDto {
    pub tool: String,
    pub mode: String,
    pub status: String,
    pub target_path: String,
    pub synced_at: Option<i64>,
}

#[tauri::command]
pub fn get_managed_skills(store: State<'_, SkillStore>) -> Result<Vec<ManagedSkillDto>, String> {
    get_managed_skills_impl(store.inner())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn delete_managed_skill(
    store: State<'_, SkillStore>,
    skillId: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // 便于排查“按钮点了没反应”：确认前端确实触发了命令
        println!("[delete_managed_skill] skillId={}", skillId);

        // 先删除已同步到各工具目录的副本/软链接
        // 注意：如果先删 skills 行，会触发 skill_targets cascade，导致无法再拿到 target_path
        let targets = store.list_skill_targets(&skillId)?;

        let mut remove_failures: Vec<String> = Vec::new();
        for target in targets {
            if let Err(err) = remove_path_any(&target.target_path) {
                remove_failures.push(format!("{}: {}", target.target_path, err));
            }
        }

        let record = store.get_skill_by_id(&skillId)?;
        if let Some(skill) = record {
            let path = std::path::PathBuf::from(skill.central_path);
            if path.exists() {
                std::fs::remove_dir_all(&path)?;
            }
            store.delete_skill(&skillId)?;
        }

        if !remove_failures.is_empty() {
            anyhow::bail!(
                "已删除托管记录，但清理部分工具目录失败：\n- {}",
                remove_failures.join("\n- ")
            );
        }

        Ok::<_, anyhow::Error>(())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

fn remove_path_any(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Ok(());
    }

    let meta = std::fs::symlink_metadata(p).map_err(|err| err.to_string())?;
    let ft = meta.file_type();

    // 软链接（即使指向目录）也应该用 remove_file 删除链接本身
    if ft.is_symlink() {
        std::fs::remove_file(p).map_err(|err| err.to_string())?;
        return Ok(());
    }

    if ft.is_dir() {
        std::fs::remove_dir_all(p).map_err(|err| err.to_string())?;
        return Ok(());
    }

    std::fs::remove_file(p).map_err(|err| err.to_string())?;
    Ok(())
}

fn to_install_dto(result: InstallResult) -> InstallResultDto {
    InstallResultDto {
        skill_id: result.skill_id,
        name: result.name,
        central_path: result.central_path.to_string_lossy().to_string(),
        content_hash: result.content_hash,
    }
}

fn now_ms() -> i64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    now.as_millis() as i64
}

fn get_managed_skills_impl(store: &SkillStore) -> Result<Vec<ManagedSkillDto>, String> {
    let skills = store.list_skills().map_err(|err| err.to_string())?;
    Ok(skills
        .into_iter()
        .map(|skill| {
            let targets = store
                .list_skill_targets(&skill.id)
                .unwrap_or_default()
                .into_iter()
                .map(|target| SkillTargetDto {
                    tool: target.tool,
                    mode: target.mode,
                    status: target.status,
                    target_path: target.target_path,
                    synced_at: target.synced_at,
                })
                .collect();

            ManagedSkillDto {
                id: skill.id,
                name: skill.name,
                source_type: skill.source_type,
                source_ref: skill.source_ref,
                central_path: skill.central_path,
                created_at: skill.created_at,
                updated_at: skill.updated_at,
                last_sync_at: skill.last_sync_at,
                status: skill.status,
                targets,
            }
        })
        .collect())
}

#[cfg(test)]
#[path = "tests/commands.rs"]
mod tests;
