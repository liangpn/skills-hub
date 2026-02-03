use std::path::PathBuf;

use crate::core::skill_store::{
    LlmAgentRecord, LlmPromptRecord, LlmProviderRecord, SkillRecord, SkillStore, SkillTargetRecord,
};

fn make_store() -> (tempfile::TempDir, SkillStore) {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("test.db");
    let store = SkillStore::new(db);
    store.ensure_schema().expect("ensure_schema");
    (dir, store)
}

fn make_skill(id: &str, name: &str, central_path: &str, updated_at: i64) -> SkillRecord {
    SkillRecord {
        id: id.to_string(),
        name: name.to_string(),
        source_type: "local".to_string(),
        source_ref: Some("/tmp/source".to_string()),
        source_revision: None,
        central_path: central_path.to_string(),
        content_hash: None,
        created_at: 1,
        updated_at,
        last_sync_at: None,
        last_seen_at: 1,
        status: "ok".to_string(),
    }
}

fn make_llm_provider(id: &str, name: &str) -> LlmProviderRecord {
    LlmProviderRecord {
        id: id.to_string(),
        name: name.to_string(),
        provider_type: "openai".to_string(),
        base_url: Some("https://api.openai.com/v1".to_string()),
        api_key_env: None,
        api_key: None,
        default_model: Some("gpt-4o-mini".to_string()),
        created_at_ms: 1,
        updated_at_ms: 1,
    }
}

fn make_llm_prompt(id: &str, name: &str, prompt_md: &str) -> LlmPromptRecord {
    LlmPromptRecord {
        id: id.to_string(),
        name: name.to_string(),
        prompt_md: prompt_md.to_string(),
        created_at_ms: 1,
        updated_at_ms: 1,
    }
}

#[test]
fn schema_is_idempotent() {
    let (_dir, store) = make_store();
    store.ensure_schema().expect("ensure_schema again");
}

#[test]
fn resolve_llm_agent_system_prompt_prefers_prompt_table() {
    let (_dir, store) = make_store();

    store
        .upsert_llm_provider(&make_llm_provider("p1", "provider-1"))
        .unwrap();
    store
        .upsert_llm_prompt(&make_llm_prompt("pr1", "prompt-1", "PROMPT_FROM_TABLE"))
        .unwrap();

    let agent = LlmAgentRecord {
        id: "a1".to_string(),
        name: "agent-1".to_string(),
        provider_id: "p1".to_string(),
        model: None,
        prompt_md: "INLINE_PROMPT".to_string(),
        prompt_id: Some("pr1".to_string()),
        created_at_ms: 1,
        updated_at_ms: 1,
    };
    assert_eq!(
        store.resolve_llm_agent_system_prompt(&agent).unwrap(),
        "PROMPT_FROM_TABLE"
    );

    let agent_inline = LlmAgentRecord {
        prompt_id: None,
        ..agent
    };
    assert_eq!(
        store.resolve_llm_agent_system_prompt(&agent_inline).unwrap(),
        "INLINE_PROMPT"
    );
}

#[test]
fn settings_roundtrip_and_update() {
    let (_dir, store) = make_store();

    assert_eq!(store.get_setting("missing").unwrap(), None);
    store.set_setting("k", "v1").unwrap();
    assert_eq!(store.get_setting("k").unwrap().as_deref(), Some("v1"));
    store.set_setting("k", "v2").unwrap();
    assert_eq!(store.get_setting("k").unwrap().as_deref(), Some("v2"));

    store.set_onboarding_completed(true).unwrap();
    assert_eq!(
        store
            .get_setting("onboarding_completed")
            .unwrap()
            .as_deref(),
        Some("true")
    );
    store.set_onboarding_completed(false).unwrap();
    assert_eq!(
        store
            .get_setting("onboarding_completed")
            .unwrap()
            .as_deref(),
        Some("false")
    );
}

#[test]
fn skills_upsert_list_get_delete() {
    let (_dir, store) = make_store();

    let a = make_skill("a", "A", "/central/a", 10);
    let b = make_skill("b", "B", "/central/b", 20);
    store.upsert_skill(&a).unwrap();
    store.upsert_skill(&b).unwrap();

    let listed = store.list_skills().unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, "b");
    assert_eq!(listed[1].id, "a");

    let got = store.get_skill_by_id("a").unwrap().unwrap();
    assert_eq!(got.name, "A");

    let mut a2 = a.clone();
    a2.name = "A2".to_string();
    a2.updated_at = 30;
    store.upsert_skill(&a2).unwrap();
    assert_eq!(store.get_skill_by_id("a").unwrap().unwrap().name, "A2");
    assert_eq!(store.list_skills().unwrap()[0].id, "a");

    store.delete_skill("a").unwrap();
    assert!(store.get_skill_by_id("a").unwrap().is_none());
}

#[test]
fn skill_targets_upsert_unique_constraint_and_list_order() {
    let (_dir, store) = make_store();
    let skill = make_skill("s1", "S1", "/central/s1", 1);
    store.upsert_skill(&skill).unwrap();

    let t1 = SkillTargetRecord {
        id: "t1".to_string(),
        skill_id: "s1".to_string(),
        tool: "cursor".to_string(),
        target_path: "/target/1".to_string(),
        mode: "copy".to_string(),
        status: "ok".to_string(),
        last_error: None,
        synced_at: None,
    };
    store.upsert_skill_target(&t1).unwrap();
    assert_eq!(
        store
            .get_skill_target("s1", "cursor")
            .unwrap()
            .unwrap()
            .target_path,
        "/target/1"
    );

    let mut t1b = t1.clone();
    t1b.id = "t2".to_string();
    t1b.target_path = "/target/2".to_string();
    store.upsert_skill_target(&t1b).unwrap();
    assert_eq!(
        store.get_skill_target("s1", "cursor").unwrap().unwrap().id,
        "t1",
        "unique(skill_id, tool) 冲突时应更新现有行而不是替换 id"
    );
    assert_eq!(
        store
            .get_skill_target("s1", "cursor")
            .unwrap()
            .unwrap()
            .target_path,
        "/target/2"
    );

    let t2 = SkillTargetRecord {
        id: "t3".to_string(),
        skill_id: "s1".to_string(),
        tool: "claude_code".to_string(),
        target_path: "/target/cc".to_string(),
        mode: "copy".to_string(),
        status: "ok".to_string(),
        last_error: None,
        synced_at: None,
    };
    store.upsert_skill_target(&t2).unwrap();

    let targets = store.list_skill_targets("s1").unwrap();
    assert_eq!(targets.len(), 2);
    assert_eq!(targets[0].tool, "claude_code");
    assert_eq!(targets[1].tool, "cursor");

    store.delete_skill_target("s1", "cursor").unwrap();
    assert!(store.get_skill_target("s1", "cursor").unwrap().is_none());
}

#[test]
fn deleting_skill_cascades_targets() {
    let (_dir, store) = make_store();
    let skill = make_skill("s1", "S1", "/central/s1", 1);
    store.upsert_skill(&skill).unwrap();

    let t = SkillTargetRecord {
        id: "t1".to_string(),
        skill_id: "s1".to_string(),
        tool: "cursor".to_string(),
        target_path: "/target/1".to_string(),
        mode: "copy".to_string(),
        status: "ok".to_string(),
        last_error: None,
        synced_at: None,
    };
    store.upsert_skill_target(&t).unwrap();
    assert_eq!(store.list_skill_targets("s1").unwrap().len(), 1);

    store.delete_skill("s1").unwrap();
    assert_eq!(store.list_skill_targets("s1").unwrap().len(), 0);
}

#[test]
fn error_context_includes_db_path() {
    let store = SkillStore::new(PathBuf::from("/this/path/should/not/exist/test.db"));
    let err = store.ensure_schema().unwrap_err();
    let msg = format!("{:#}", err);
    assert!(msg.contains("failed to open db at"), "{msg}");
}

#[test]
fn migrates_schema_v1_to_v3_adds_analytics_tables() {
    use rusqlite::Connection;

    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("test.db");

    // Simulate an existing v1 database created by an older app version.
    let conn = Connection::open(&db).expect("open");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("pragma");
    conn.execute_batch(
        r#"
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
"#,
    )
    .expect("schema v1");
    conn.pragma_update(None, "user_version", 1)
        .expect("set user_version=1");
    drop(conn);

    let store = SkillStore::new(db);
    store.ensure_schema().expect("ensure_schema migrates");

    let conn = Connection::open(store.db_path()).expect("open2");
    let user_version: i32 = conn
        .query_row("PRAGMA user_version;", [], |row| row.get(0))
        .expect("user_version");
    assert_eq!(user_version, 6);

    let tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='skill_usage_events';",
            [],
            |row| row.get(0),
        )
        .expect("tables");
    assert_eq!(tables, 1);

    let tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='codex_scan_cursors';",
            [],
            |row| row.get(0),
        )
        .expect("tables2");
    assert_eq!(tables, 1);

    let tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='llm_providers';",
            [],
            |row| row.get(0),
        )
        .expect("tables3");
    assert_eq!(tables, 1);

    let tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='llm_agents';",
            [],
            |row| row.get(0),
        )
        .expect("tables4");
    assert_eq!(tables, 1);

    let tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='llm_prompts';",
            [],
            |row| row.get(0),
        )
        .expect("tables5");
    assert_eq!(tables, 1);

    // v5 adds stored provider API keys (api_key column).
    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(llm_providers);")
        .expect("pragma stmt providers")
        .query_map([], |row| row.get::<_, String>(1))
        .expect("pragma rows providers")
        .map(|r| r.expect("col"))
        .collect();
    assert!(cols.contains(&"api_key".to_string()));

    // v3 schema stores skill_key and managed_skill_id.
    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(skill_usage_events);")
        .expect("pragma stmt")
        .query_map([], |row| row.get::<_, String>(1))
        .expect("pragma rows")
        .map(|r| r.expect("col"))
        .collect();
    assert!(cols.contains(&"skill_key".to_string()));
    assert!(cols.contains(&"managed_skill_id".to_string()));

    // v6 adds prompt_id on llm_agents.
    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(llm_agents);")
        .expect("pragma stmt agents")
        .query_map([], |row| row.get::<_, String>(1))
        .expect("pragma rows agents")
        .map(|r| r.expect("col"))
        .collect();
    assert!(cols.contains(&"prompt_id".to_string()));
}

#[test]
fn migrates_schema_v5_to_v6_adds_prompts_and_backfills_agent_prompt_id() {
    use rusqlite::Connection;

    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("test.db");

    // Simulate an existing v5 database created by an older app version (agents store prompt_md inline).
    let conn = Connection::open(&db).expect("open");
    conn.execute_batch("PRAGMA foreign_keys = ON;").expect("pragma");
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider_type TEXT NOT NULL,
  base_url TEXT NULL,
  api_key_env TEXT NULL,
  default_model TEXT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  api_key TEXT NULL
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
"#,
    )
    .expect("schema v5 (partial)");
    conn.pragma_update(None, "user_version", 5)
        .expect("set user_version=5");

    conn.execute(
        "INSERT INTO llm_providers (id, name, provider_type, base_url, api_key_env, default_model, created_at_ms, updated_at_ms, api_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            "p1",
            "openai-main",
            "openai",
            "https://api.openai.com/v1",
            Option::<String>::None,
            "gpt-4o-mini",
            1_i64,
            1_i64,
            Option::<String>::None
        ],
    )
    .expect("insert provider");
    conn.execute(
        "INSERT INTO llm_agents (id, name, provider_id, model, prompt_md, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params!["a1", "agent-1", "p1", Option::<String>::None, "PROMPT_V5", 1_i64, 1_i64],
    )
    .expect("insert agent");

    drop(conn);

    let store = SkillStore::new(db);
    store.ensure_schema().expect("ensure_schema migrates to v6");

    let conn = Connection::open(store.db_path()).expect("open2");
    let user_version: i32 = conn
        .query_row("PRAGMA user_version;", [], |row| row.get(0))
        .expect("user_version");
    assert_eq!(user_version, 6);

    let prompts_tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='llm_prompts';",
            [],
            |row| row.get(0),
        )
        .expect("prompts table exists");
    assert_eq!(prompts_tables, 1);

    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(llm_agents);")
        .expect("pragma stmt agents")
        .query_map([], |row| row.get::<_, String>(1))
        .expect("pragma rows agents")
        .map(|r| r.expect("col"))
        .collect();
    assert!(cols.contains(&"prompt_id".to_string()));

    let (prompt_id, prompt_md): (String, String) = conn
        .query_row(
            "SELECT prompt_id, prompt_md FROM llm_agents WHERE id = ?1",
            ["a1"],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("agent prompt_id populated");
    assert!(!prompt_id.trim().is_empty());
    assert_eq!(prompt_md, "PROMPT_V5");

    let stored_prompt: String = conn
        .query_row(
            "SELECT prompt_md FROM llm_prompts WHERE id = ?1",
            [prompt_id],
            |row| row.get(0),
        )
        .expect("prompt row exists");
    assert_eq!(stored_prompt, "PROMPT_V5");
}

#[test]
fn usage_leaderboard_aggregates_calls_projects_and_tools() {
    use crate::core::skill_store::{SkillUsageLeaderboardRow, SkillUsageProjectRow};

    let (_dir, store) = make_store();

    let s1 = make_skill("s1", "skill-1", "/central/s1", 1);
    let s2 = make_skill("s2", "skill-2", "/central/s2", 1);
    store.upsert_skill(&s1).unwrap();
    store.upsert_skill(&s2).unwrap();

    // Two tools synced for s1.
    store
        .upsert_skill_target(&SkillTargetRecord {
            id: "t1".to_string(),
            skill_id: "s1".to_string(),
            tool: "codex".to_string(),
            target_path: "/target/codex".to_string(),
            mode: "symlink".to_string(),
            status: "ok".to_string(),
            last_error: None,
            synced_at: None,
        })
        .unwrap();
    store
        .upsert_skill_target(&SkillTargetRecord {
            id: "t2".to_string(),
            skill_id: "s1".to_string(),
            tool: "cursor".to_string(),
            target_path: "/target/cursor".to_string(),
            mode: "copy".to_string(),
            status: "ok".to_string(),
            last_error: None,
            synced_at: None,
        })
        .unwrap();

    // Usage events: s1 twice (two projects), s2 once.
    assert!(store
        .insert_skill_usage_event(
            "codex",
            "skill-1",
            Some("s1"),
            100,
            "/wd",
            "/p1",
            "/log",
            1,
            100
        )
        .unwrap());
    assert!(store
        .insert_skill_usage_event(
            "codex",
            "skill-1",
            Some("s1"),
            200,
            "/wd",
            "/p2",
            "/log",
            2,
            200
        )
        .unwrap());
    assert!(store
        .insert_skill_usage_event(
            "codex",
            "skill-2",
            Some("s2"),
            300,
            "/wd",
            "/p1",
            "/log",
            3,
            300
        )
        .unwrap());

    let rows: Vec<SkillUsageLeaderboardRow> = store
        .get_skill_usage_leaderboard("codex", None, 50)
        .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].skill_id, "skill-1");
    assert_eq!(rows[0].calls, 2);
    assert_eq!(rows[0].projects, 2);
    assert_eq!(rows[0].tools, 2);
    assert_eq!(rows[1].skill_id, "skill-2");
    assert_eq!(rows[1].calls, 1);

    let details: Vec<SkillUsageProjectRow> = store
        .get_skill_usage_by_project("codex", "skill-1", None)
        .unwrap();
    assert_eq!(details.len(), 2);
    assert_eq!(details[0].calls, 1);
}
