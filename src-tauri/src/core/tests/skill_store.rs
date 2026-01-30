use std::path::PathBuf;

use crate::core::skill_store::{SkillRecord, SkillStore, SkillTargetRecord};

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

#[test]
fn schema_is_idempotent() {
    let (_dir, store) = make_store();
    store.ensure_schema().expect("ensure_schema again");
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
    assert_eq!(user_version, 3);

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
