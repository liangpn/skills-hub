use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::Manager;
use uuid::Uuid;

const DB_FILE_NAME: &str = "skills_hub.db";
const LEGACY_APP_IDENTIFIERS: &[&str] = &["com.tauri.dev", "com.tauri.dev.skillshub"];

// Schema versioning: bump when making changes and add a migration step.
const SCHEMA_VERSION: i32 = 5;

// Minimal schema for MVP: skills, skill_targets, settings, discovered_skills(optional).
const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NULL,
  source_revision TEXT NULL,
  central_path TEXT NOT NULL UNIQUE,
  content_hash TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sync_at INTEGER NULL,
  last_seen_at INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_targets (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  target_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  last_error TEXT NULL,
  synced_at INTEGER NULL,
  UNIQUE(skill_id, tool),
  FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovered_skills (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  found_path TEXT NOT NULL,
  name_guess TEXT NULL,
  fingerprint TEXT NULL,
  found_at INTEGER NOT NULL,
  imported_skill_id TEXT NULL,
  FOREIGN KEY(imported_skill_id) REFERENCES skills(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
CREATE INDEX IF NOT EXISTS idx_skills_updated_at ON skills(updated_at);
"#;

// Schema v3: usage events store `skill_key` so we can track non-managed skills installed under
// `~/.codex/skills/**`, while keeping an optional `managed_skill_id` link for joins.
const SCHEMA_V3: &str = r#"
CREATE TABLE IF NOT EXISTS skill_usage_events (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  skill_key TEXT NOT NULL,
  managed_skill_id TEXT NULL,
  ts_ms INTEGER NOT NULL,
  workdir TEXT NOT NULL,
  project_path TEXT NOT NULL,
  log_path TEXT NOT NULL,
  log_line INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(tool, log_path, log_line),
  FOREIGN KEY(managed_skill_id) REFERENCES skills(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS codex_scan_cursors (
  log_path TEXT PRIMARY KEY,
  last_line INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_usage_events_key_ts
  ON skill_usage_events(skill_key, ts_ms);
CREATE INDEX IF NOT EXISTS idx_skill_usage_events_managed_ts
  ON skill_usage_events(managed_skill_id, ts_ms);
CREATE INDEX IF NOT EXISTS idx_skill_usage_events_project
  ON skill_usage_events(project_path);
"#;

// Schema v4: LLM provider + agent configs.
const SCHEMA_V4: &str = r#"
CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider_type TEXT NOT NULL,
  base_url TEXT NULL,
  api_key_env TEXT NULL,
  default_model TEXT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider_id TEXT NOT NULL,
  model TEXT NULL,
  prompt_md TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(provider_id) REFERENCES llm_providers(id)
);

CREATE INDEX IF NOT EXISTS idx_llm_providers_updated_at
  ON llm_providers(updated_at_ms);
CREATE INDEX IF NOT EXISTS idx_llm_agents_updated_at
  ON llm_agents(updated_at_ms);
CREATE INDEX IF NOT EXISTS idx_llm_agents_provider
  ON llm_agents(provider_id);
"#;

// Schema v5: Allow storing provider API keys in sqlite (local-only).
const SCHEMA_V5: &str = r#"
ALTER TABLE llm_providers ADD COLUMN api_key TEXT NULL;
"#;

#[derive(Clone, Debug)]
pub struct SkillStore {
    db_path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub source_type: String,
    pub source_ref: Option<String>,
    pub source_revision: Option<String>,
    pub central_path: String,
    pub content_hash: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_sync_at: Option<i64>,
    pub last_seen_at: i64,
    pub status: String,
}

#[derive(Clone, Debug)]
pub struct SkillTargetRecord {
    pub id: String,
    pub skill_id: String,
    pub tool: String,
    pub target_path: String,
    pub mode: String,
    pub status: String,
    pub last_error: Option<String>,
    pub synced_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SkillUsageLeaderboardRow {
    pub skill_id: String,
    pub skill_name: String,
    pub calls: i64,
    pub projects: i64,
    pub tools: i64,
    pub last_ts_ms: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SkillUsageProjectRow {
    pub project_path: String,
    pub calls: i64,
    pub last_ts_ms: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct LlmProviderRecord {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: Option<String>,
    pub api_key_env: Option<String>,
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
    pub default_model: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct LlmAgentRecord {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub model: Option<String>,
    pub prompt_md: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

impl SkillStore {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    #[allow(dead_code)]
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn ensure_schema(&self) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute_batch("PRAGMA foreign_keys = ON;")?;

            let user_version: i32 = conn.query_row("PRAGMA user_version;", [], |row| row.get(0))?;
            if user_version == 0 {
                conn.execute_batch(SCHEMA_V1)?;
                conn.execute_batch(SCHEMA_V3)?;
                conn.execute_batch(SCHEMA_V4)?;
                conn.execute_batch(SCHEMA_V5)?;
                conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            } else if user_version == 1 {
                conn.execute_batch(SCHEMA_V3)?;
                conn.execute_batch(SCHEMA_V4)?;
                conn.execute_batch(SCHEMA_V5)?;
                conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            } else if user_version == 2 {
                // v2 -> v3: migrate usage events to store skill_key + optional managed_skill_id.
                conn.execute_batch(
                    r#"
CREATE TABLE IF NOT EXISTS skill_usage_events_v3 (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  skill_key TEXT NOT NULL,
  managed_skill_id TEXT NULL,
  ts_ms INTEGER NOT NULL,
  workdir TEXT NOT NULL,
  project_path TEXT NOT NULL,
  log_path TEXT NOT NULL,
  log_line INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(tool, log_path, log_line),
  FOREIGN KEY(managed_skill_id) REFERENCES skills(id) ON DELETE SET NULL
);

INSERT INTO skill_usage_events_v3 (
  id,
  tool,
  skill_key,
  managed_skill_id,
  ts_ms,
  workdir,
  project_path,
  log_path,
  log_line,
  created_at_ms
)
SELECT
  e.id,
  e.tool,
  COALESCE(s.name, e.skill_id) AS skill_key,
  e.skill_id AS managed_skill_id,
  e.ts_ms,
  e.workdir,
  e.project_path,
  e.log_path,
  e.log_line,
  e.created_at_ms
FROM skill_usage_events e
LEFT JOIN skills s ON s.id = e.skill_id;

DROP TABLE skill_usage_events;
ALTER TABLE skill_usage_events_v3 RENAME TO skill_usage_events;

CREATE INDEX IF NOT EXISTS idx_skill_usage_events_key_ts
  ON skill_usage_events(skill_key, ts_ms);
CREATE INDEX IF NOT EXISTS idx_skill_usage_events_managed_ts
  ON skill_usage_events(managed_skill_id, ts_ms);
CREATE INDEX IF NOT EXISTS idx_skill_usage_events_project
  ON skill_usage_events(project_path);
"#,
                )?;
                conn.execute_batch(SCHEMA_V4)?;
                conn.execute_batch(SCHEMA_V5)?;
                conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            } else if user_version == 3 {
                conn.execute_batch(SCHEMA_V4)?;
                conn.execute_batch(SCHEMA_V5)?;
                conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            } else if user_version == 4 {
                conn.execute_batch(SCHEMA_V5)?;
                conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            } else if user_version > SCHEMA_VERSION {
                anyhow::bail!(
                    "database schema version {} is newer than app supports {}",
                    user_version,
                    SCHEMA_VERSION
                );
            }

            Ok(())
        })
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
            let mut rows = stmt.query(params![key])?;
            Ok(rows
                .next()?
                .map(|row| row.get::<_, String>(0))
                .transpose()?)
        })
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }

    #[allow(dead_code)]
    pub fn set_onboarding_completed(&self, completed: bool) -> Result<()> {
        self.set_setting(
            "onboarding_completed",
            if completed { "true" } else { "false" },
        )
    }

    pub fn upsert_skill(&self, record: &SkillRecord) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO skills (
          id, name, source_type, source_ref, source_revision, central_path, content_hash,
          created_at, updated_at, last_sync_at, last_seen_at, status
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7,
          ?8, ?9, ?10, ?11, ?12
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          source_type = excluded.source_type,
          source_ref = excluded.source_ref,
          source_revision = excluded.source_revision,
          central_path = excluded.central_path,
          content_hash = excluded.content_hash,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_sync_at = excluded.last_sync_at,
          last_seen_at = excluded.last_seen_at,
          status = excluded.status",
                params![
                    record.id,
                    record.name,
                    record.source_type,
                    record.source_ref,
                    record.source_revision,
                    record.central_path,
                    record.content_hash,
                    record.created_at,
                    record.updated_at,
                    record.last_sync_at,
                    record.last_seen_at,
                    record.status
                ],
            )?;
            Ok(())
        })
    }

    pub fn upsert_skill_target(&self, record: &SkillTargetRecord) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO skill_targets (
          id, skill_id, tool, target_path, mode, status, last_error, synced_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
        )
        ON CONFLICT(skill_id, tool) DO UPDATE SET
          target_path = excluded.target_path,
          mode = excluded.mode,
          status = excluded.status,
          last_error = excluded.last_error,
          synced_at = excluded.synced_at",
                params![
                    record.id,
                    record.skill_id,
                    record.tool,
                    record.target_path,
                    record.mode,
                    record.status,
                    record.last_error,
                    record.synced_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn list_skills(&self) -> Result<Vec<SkillRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
        "SELECT id, name, source_type, source_ref, source_revision, central_path, content_hash,
                created_at, updated_at, last_sync_at, last_seen_at, status
         FROM skills
         ORDER BY updated_at DESC",
      )?;
            let rows = stmt.query_map([], |row| {
                Ok(SkillRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    source_type: row.get(2)?,
                    source_ref: row.get(3)?,
                    source_revision: row.get(4)?,
                    central_path: row.get(5)?,
                    content_hash: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    last_sync_at: row.get(9)?,
                    last_seen_at: row.get(10)?,
                    status: row.get(11)?,
                })
            })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }
            Ok(items)
        })
    }

    pub fn get_skill_by_id(&self, skill_id: &str) -> Result<Option<SkillRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
        "SELECT id, name, source_type, source_ref, source_revision, central_path, content_hash,
                created_at, updated_at, last_sync_at, last_seen_at, status
         FROM skills
         WHERE id = ?1
         LIMIT 1",
      )?;
            let mut rows = stmt.query(params![skill_id])?;
            if let Some(row) = rows.next()? {
                Ok(Some(SkillRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    source_type: row.get(2)?,
                    source_ref: row.get(3)?,
                    source_revision: row.get(4)?,
                    central_path: row.get(5)?,
                    content_hash: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    last_sync_at: row.get(9)?,
                    last_seen_at: row.get(10)?,
                    status: row.get(11)?,
                }))
            } else {
                Ok(None)
            }
        })
    }

    pub fn delete_skill(&self, skill_id: &str) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM skills WHERE id = ?1", params![skill_id])?;
            Ok(())
        })
    }

    pub fn list_skill_targets(&self, skill_id: &str) -> Result<Vec<SkillTargetRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, skill_id, tool, target_path, mode, status, last_error, synced_at
         FROM skill_targets
         WHERE skill_id = ?1
         ORDER BY tool ASC",
            )?;
            let rows = stmt.query_map(params![skill_id], |row| {
                Ok(SkillTargetRecord {
                    id: row.get(0)?,
                    skill_id: row.get(1)?,
                    tool: row.get(2)?,
                    target_path: row.get(3)?,
                    mode: row.get(4)?,
                    status: row.get(5)?,
                    last_error: row.get(6)?,
                    synced_at: row.get(7)?,
                })
            })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }
            Ok(items)
        })
    }

    pub fn list_all_skill_target_paths(&self) -> Result<Vec<(String, String)>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT tool, target_path
         FROM skill_targets",
            )?;
            let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }
            Ok(items)
        })
    }

    pub fn list_llm_providers(&self) -> Result<Vec<LlmProviderRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, provider_type, base_url, api_key_env, api_key, default_model, created_at_ms, updated_at_ms
         FROM llm_providers
         ORDER BY updated_at_ms DESC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(LlmProviderRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_type: row.get(2)?,
                    base_url: row.get(3)?,
                    api_key_env: row.get(4)?,
                    api_key: row.get(5)?,
                    default_model: row.get(6)?,
                    created_at_ms: row.get(7)?,
                    updated_at_ms: row.get(8)?,
                })
            })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }
            Ok(items)
        })
    }

    pub fn get_llm_provider_by_id(&self, id: &str) -> Result<Option<LlmProviderRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, provider_type, base_url, api_key_env, api_key, default_model, created_at_ms, updated_at_ms
         FROM llm_providers
         WHERE id = ?1
         LIMIT 1",
            )?;
            let mut rows = stmt.query(params![id])?;
            if let Some(row) = rows.next()? {
                Ok(Some(LlmProviderRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_type: row.get(2)?,
                    base_url: row.get(3)?,
                    api_key_env: row.get(4)?,
                    api_key: row.get(5)?,
                    default_model: row.get(6)?,
                    created_at_ms: row.get(7)?,
                    updated_at_ms: row.get(8)?,
                }))
            } else {
                Ok(None)
            }
        })
    }

    pub fn upsert_llm_provider(&self, record: &LlmProviderRecord) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO llm_providers (
          id, name, provider_type, base_url, api_key_env, api_key, default_model, created_at_ms, updated_at_ms
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          provider_type = excluded.provider_type,
          base_url = excluded.base_url,
          api_key_env = excluded.api_key_env,
          api_key = excluded.api_key,
          default_model = excluded.default_model,
          created_at_ms = excluded.created_at_ms,
          updated_at_ms = excluded.updated_at_ms",
                params![
                    record.id,
                    record.name,
                    record.provider_type,
                    record.base_url,
                    record.api_key_env,
                    record.api_key,
                    record.default_model,
                    record.created_at_ms,
                    record.updated_at_ms
                ],
            )?;
            Ok(())
        })
    }

    pub fn count_llm_agents_for_provider(&self, provider_id: &str) -> Result<i64> {
        self.with_conn(|conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM llm_agents WHERE provider_id = ?1",
                params![provider_id],
                |row| row.get(0),
            )?;
            Ok(count)
        })
    }

    pub fn delete_llm_provider(&self, provider_id: &str) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM llm_providers WHERE id = ?1", params![provider_id])?;
            Ok(())
        })
    }

    pub fn list_llm_agents(&self) -> Result<Vec<LlmAgentRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, provider_id, model, prompt_md, created_at_ms, updated_at_ms
         FROM llm_agents
         ORDER BY updated_at_ms DESC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(LlmAgentRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_id: row.get(2)?,
                    model: row.get(3)?,
                    prompt_md: row.get(4)?,
                    created_at_ms: row.get(5)?,
                    updated_at_ms: row.get(6)?,
                })
            })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }
            Ok(items)
        })
    }

    pub fn get_llm_agent_by_id(&self, id: &str) -> Result<Option<LlmAgentRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, provider_id, model, prompt_md, created_at_ms, updated_at_ms
         FROM llm_agents
         WHERE id = ?1
         LIMIT 1",
            )?;
            let mut rows = stmt.query(params![id])?;
            if let Some(row) = rows.next()? {
                Ok(Some(LlmAgentRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_id: row.get(2)?,
                    model: row.get(3)?,
                    prompt_md: row.get(4)?,
                    created_at_ms: row.get(5)?,
                    updated_at_ms: row.get(6)?,
                }))
            } else {
                Ok(None)
            }
        })
    }

    pub fn upsert_llm_agent(&self, record: &LlmAgentRecord) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO llm_agents (
          id, name, provider_id, model, prompt_md, created_at_ms, updated_at_ms
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          provider_id = excluded.provider_id,
          model = excluded.model,
          prompt_md = excluded.prompt_md,
          created_at_ms = excluded.created_at_ms,
          updated_at_ms = excluded.updated_at_ms",
                params![
                    record.id,
                    record.name,
                    record.provider_id,
                    record.model,
                    record.prompt_md,
                    record.created_at_ms,
                    record.updated_at_ms
                ],
            )?;
            Ok(())
        })
    }

    pub fn delete_llm_agent(&self, agent_id: &str) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM llm_agents WHERE id = ?1", params![agent_id])?;
            Ok(())
        })
    }

    pub fn get_codex_scan_cursor_last_line(&self, log_path: &str) -> Result<Option<i64>> {
        self.with_conn(|conn| {
            let mut stmt =
                conn.prepare("SELECT last_line FROM codex_scan_cursors WHERE log_path = ?1")?;
            let mut rows = stmt.query(params![log_path])?;
            Ok(rows.next()?.map(|row| row.get::<_, i64>(0)).transpose()?)
        })
    }

    pub fn upsert_codex_scan_cursor(
        &self,
        log_path: &str,
        last_line: i64,
        updated_at_ms: i64,
    ) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO codex_scan_cursors (log_path, last_line, updated_at_ms)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(log_path) DO UPDATE SET
           last_line = excluded.last_line,
           updated_at_ms = excluded.updated_at_ms",
                params![log_path, last_line, updated_at_ms],
            )?;
            Ok(())
        })
    }

    pub fn insert_skill_usage_event(
        &self,
        tool: &str,
        skill_key: &str,
        managed_skill_id: Option<&str>,
        ts_ms: i64,
        workdir: &str,
        project_path: &str,
        log_path: &str,
        log_line: i64,
        created_at_ms: i64,
    ) -> Result<bool> {
        let id = Uuid::new_v4().to_string();
        self.with_conn(|conn| {
            let rows = conn.execute(
                "INSERT OR IGNORE INTO skill_usage_events (
          id, tool, skill_key, managed_skill_id, ts_ms, workdir, project_path, log_path, log_line, created_at_ms
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
        )",
                params![
                    id,
                    tool,
                    skill_key,
                    managed_skill_id,
                    ts_ms,
                    workdir,
                    project_path,
                    log_path,
                    log_line,
                    created_at_ms
                ],
            )?;
            Ok(rows > 0)
        })
    }

    pub fn delete_skill_usage_events_before(
        &self,
        tool: &str,
        ts_ms_exclusive: i64,
    ) -> Result<usize> {
        self.with_conn(|conn| {
            let rows = conn.execute(
                "DELETE FROM skill_usage_events WHERE tool = ?1 AND ts_ms < ?2",
                params![tool, ts_ms_exclusive],
            )?;
            Ok(rows)
        })
    }

    pub fn delete_skill_usage_events_for_tool(&self, tool: &str) -> Result<usize> {
        self.with_conn(|conn| {
            let rows = conn.execute(
                "DELETE FROM skill_usage_events WHERE tool = ?1",
                params![tool],
            )?;
            Ok(rows)
        })
    }

    pub fn clear_codex_scan_cursors(&self) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM codex_scan_cursors", [])?;
            Ok(())
        })
    }

    pub fn get_skill_usage_leaderboard(
        &self,
        tool: &str,
        since_ts_ms: Option<i64>,
        limit: i64,
    ) -> Result<Vec<SkillUsageLeaderboardRow>> {
        let limit = limit.max(0);
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                r#"
WITH agg AS (
  SELECT
    skill_key,
    MIN(managed_skill_id) AS managed_skill_id,
    COUNT(*) AS calls,
    COUNT(DISTINCT project_path) AS projects,
    COALESCE(MAX(ts_ms), 0) AS last_ts_ms
  FROM skill_usage_events
  WHERE tool = ?1
    AND (?2 IS NULL OR ts_ms >= ?2)
  GROUP BY skill_key
)
SELECT
  agg.skill_key AS skill_id,
  COALESCE(s.name, agg.skill_key) AS skill_name,
  agg.calls,
  agg.projects,
  CASE
    WHEN agg.managed_skill_id IS NULL THEN 1
    ELSE COALESCE(t.tools, 0)
  END AS tools,
  agg.last_ts_ms
FROM agg
LEFT JOIN skills s ON s.id = agg.managed_skill_id
LEFT JOIN (
  SELECT skill_id, COUNT(*) AS tools
  FROM skill_targets
  GROUP BY skill_id
) t ON t.skill_id = agg.managed_skill_id
ORDER BY calls DESC, last_ts_ms DESC, skill_name ASC
LIMIT ?3;
"#,
            )?;

            let rows = stmt.query_map(params![tool, since_ts_ms, limit], |row| {
                Ok(SkillUsageLeaderboardRow {
                    skill_id: row.get(0)?,
                    skill_name: row.get(1)?,
                    calls: row.get(2)?,
                    projects: row.get(3)?,
                    tools: row.get(4)?,
                    last_ts_ms: row.get(5)?,
                })
            })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }
            Ok(items)
        })
    }

    pub fn get_skill_usage_by_project(
        &self,
        tool: &str,
        skill_key: &str,
        since_ts_ms: Option<i64>,
    ) -> Result<Vec<SkillUsageProjectRow>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                r#"
SELECT
  project_path,
  COUNT(*) AS calls,
  COALESCE(MAX(ts_ms), 0) AS last_ts_ms
FROM skill_usage_events
WHERE tool = ?1
  AND skill_key = ?2
  AND (?3 IS NULL OR ts_ms >= ?3)
GROUP BY project_path
ORDER BY calls DESC, last_ts_ms DESC, project_path ASC;
"#,
            )?;

            let rows = stmt.query_map(params![tool, skill_key, since_ts_ms], |row| {
                Ok(SkillUsageProjectRow {
                    project_path: row.get(0)?,
                    calls: row.get(1)?,
                    last_ts_ms: row.get(2)?,
                })
            })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }
            Ok(items)
        })
    }

    pub fn get_skill_target(
        &self,
        skill_id: &str,
        tool: &str,
    ) -> Result<Option<SkillTargetRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, skill_id, tool, target_path, mode, status, last_error, synced_at
         FROM skill_targets
         WHERE skill_id = ?1 AND tool = ?2",
            )?;
            let mut rows = stmt.query(params![skill_id, tool])?;
            if let Some(row) = rows.next()? {
                Ok(Some(SkillTargetRecord {
                    id: row.get(0)?,
                    skill_id: row.get(1)?,
                    tool: row.get(2)?,
                    target_path: row.get(3)?,
                    mode: row.get(4)?,
                    status: row.get(5)?,
                    last_error: row.get(6)?,
                    synced_at: row.get(7)?,
                }))
            } else {
                Ok(None)
            }
        })
    }

    pub fn delete_skill_target(&self, skill_id: &str, tool: &str) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "DELETE FROM skill_targets WHERE skill_id = ?1 AND tool = ?2",
                params![skill_id, tool],
            )?;
            Ok(())
        })
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let conn = Connection::open(&self.db_path)
            .with_context(|| format!("failed to open db at {:?}", self.db_path))?;
        // Enforce foreign key constraints on every connection (rusqlite PRAGMA is per-connection).
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        f(&conn)
    }
}

pub fn default_db_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf> {
    let app_dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data dir")?;
    std::fs::create_dir_all(&app_dir)
        .with_context(|| format!("failed to create app data dir {:?}", app_dir))?;
    Ok(app_dir.join(DB_FILE_NAME))
}

pub fn migrate_legacy_db_if_needed(target_db_path: &Path) -> Result<()> {
    let Some(data_dir) = dirs::data_dir() else {
        return Ok(());
    };

    if let Ok(true) = db_has_any_skills(target_db_path) {
        return Ok(());
    }

    let legacy_db_path = LEGACY_APP_IDENTIFIERS
        .iter()
        .map(|id| data_dir.join(id).join(DB_FILE_NAME))
        .find(|path| path.exists());

    let Some(legacy_db_path) = legacy_db_path else {
        return Ok(());
    };

    if legacy_db_path == target_db_path {
        return Ok(());
    }

    if let Some(parent) = target_db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create app data dir {:?}", parent))?;
    }

    if target_db_path.exists() {
        let backup = target_db_path.with_extension(format!(
            "bak-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        ));
        std::fs::rename(target_db_path, &backup).with_context(|| {
            format!(
                "failed to backup existing db {:?} -> {:?}",
                target_db_path, backup
            )
        })?;
    }

    std::fs::copy(&legacy_db_path, target_db_path).with_context(|| {
        format!(
            "failed to migrate legacy db {:?} -> {:?}",
            legacy_db_path, target_db_path
        )
    })?;

    Ok(())
}

fn db_has_any_skills(db_path: &Path) -> Result<bool> {
    if !db_path.exists() {
        return Ok(false);
    }

    let conn =
        Connection::open(db_path).with_context(|| format!("failed to open db at {:?}", db_path))?;
    let has_table: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='skills';",
        [],
        |row| row.get(0),
    )?;
    if has_table == 0 {
        return Ok(false);
    }

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM skills;", [], |row| row.get(0))?;
    Ok(count > 0)
}

#[cfg(test)]
#[path = "tests/skill_store.rs"]
mod tests;
