use crate::core::codex_analytics::{
    cleanup_old_codex_events, clear_codex_analytics, extract_skill_key_from_command,
    parse_rollout_line_for_use_skill, scan_codex_sessions_dir, CodexScanOptions,
    CodexUseSkillEvent, ProjectMode,
};
use crate::core::skill_store::{SkillRecord, SkillStore};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

fn make_store() -> (tempfile::TempDir, SkillStore) {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("test.db");
    let store = SkillStore::new(db);
    store.ensure_schema().expect("ensure_schema");
    (dir, store)
}

fn make_skill(id: &str, name: &str, central_path: &str) -> SkillRecord {
    SkillRecord {
        id: id.to_string(),
        name: name.to_string(),
        source_type: "local".to_string(),
        source_ref: Some("/tmp/source".to_string()),
        source_revision: None,
        central_path: central_path.to_string(),
        content_hash: None,
        created_at: 1,
        updated_at: 1,
        last_sync_at: None,
        last_seen_at: 1,
        status: "ok".to_string(),
    }
}

#[test]
fn extract_skill_key_from_command_parses_use_skill_token() {
    let cmd = "~/.codex/superpowers/.codex/superpowers-codex use-skill superpowers:writing-plans";
    assert_eq!(
        extract_skill_key_from_command(cmd).as_deref(),
        Some("superpowers:writing-plans")
    );
}

#[test]
fn parse_rollout_line_for_use_skill_extracts_skill_and_workdir() {
    let line = r#"{"timestamp":"2026-01-28T14:34:27.888Z","type":"response_item","payload":{"type":"function_call","name":"shell_command","arguments":"{\"command\":\"~/.codex/superpowers/.codex/superpowers-codex use-skill superpowers:test-driven-development\",\"workdir\":\"/Users/liangpn/ai/agent-browser\",\"timeout_ms\":600000}","call_id":"call_at5cy3F78ArXz4eFxgT2jDer"}}"#;

    let expected_ts_ms = {
        let dt = OffsetDateTime::parse("2026-01-28T14:34:27.888Z", &Rfc3339).expect("parse ts");
        dt.unix_timestamp() * 1000 + i64::from(dt.millisecond())
    };

    assert_eq!(
        parse_rollout_line_for_use_skill(line),
        Some(CodexUseSkillEvent {
            ts_ms: expected_ts_ms,
            skill_key: "superpowers:test-driven-development".to_string(),
            workdir: "/Users/liangpn/ai/agent-browser".to_string(),
        })
    );
}

#[test]
fn parse_rollout_line_for_use_skill_ignores_non_function_call() {
    let line = r#"{"timestamp":"2026-01-28T13:41:34.102Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_X","output":"... use-skill superpowers:brainstorming ..."}}"#;
    assert_eq!(parse_rollout_line_for_use_skill(line), None);
}

#[test]
fn scan_codex_sessions_dir_is_incremental_and_idempotent() {
    use rusqlite::Connection;

    let (_dir, store) = make_store();

    let skill = make_skill("s1", "my-skill", "/central/my-skill");
    store.upsert_skill(&skill).expect("upsert skill");

    let fs = tempfile::tempdir().expect("tempdir fs");
    let sessions_dir = fs.path().join("sessions");
    let skills_dir = fs.path().join("skills");
    std::fs::create_dir_all(skills_dir.join("my-skill")).expect("mkdir skill");
    let log_dir = sessions_dir.join("2026/01/28");
    std::fs::create_dir_all(&log_dir).expect("mkdir");
    let workdir = fs.path().join("project");
    std::fs::create_dir_all(&workdir).expect("mkdir2");
    let log_path = log_dir.join("rollout-test.jsonl");

    let line = format!(
        r#"{{"timestamp":"2026-01-28T14:34:27.888Z","type":"response_item","payload":{{"type":"function_call","name":"shell_command","arguments":"{{\"command\":\"~/.codex/superpowers/.codex/superpowers-codex use-skill my-skill\",\"workdir\":\"{}\"}}","call_id":"call_1"}}}}"#,
        workdir.to_string_lossy()
    );
    std::fs::write(&log_path, format!("{}\n", line)).expect("write");

    let stats = scan_codex_sessions_dir(
        &store,
        CodexScanOptions {
            sessions_dir: sessions_dir.clone(),
            skills_dir: skills_dir.clone(),
            now_ms: 123,
            project_mode: ProjectMode::GitRootOrWorkdir,
        },
    )
    .expect("scan1");
    assert_eq!(stats.new_events, 1);

    let conn = Connection::open(store.db_path()).expect("open db");
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM skill_usage_events;", [], |row| {
            row.get(0)
        })
        .expect("count");
    assert_eq!(count, 1);
    let cursor: i64 = conn
        .query_row(
            "SELECT last_line FROM codex_scan_cursors WHERE log_path = ?1;",
            [log_path.to_string_lossy().to_string()],
            |row| row.get(0),
        )
        .expect("cursor");
    assert_eq!(cursor, 1);

    // Re-scan without changes should be idempotent.
    let stats = scan_codex_sessions_dir(
        &store,
        CodexScanOptions {
            sessions_dir: sessions_dir.clone(),
            skills_dir: skills_dir.clone(),
            now_ms: 124,
            project_mode: ProjectMode::GitRootOrWorkdir,
        },
    )
    .expect("scan2");
    assert_eq!(stats.new_events, 0);

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM skill_usage_events;", [], |row| {
            row.get(0)
        })
        .expect("count2");
    assert_eq!(count, 1);
}

#[test]
fn scan_normalizes_superpowers_skill_keys_when_personal_skill_exists() {
    use rusqlite::Connection;

    let (_dir, store) = make_store();

    let fs = tempfile::tempdir().expect("tempdir fs");
    let sessions_dir = fs.path().join("sessions");
    let skills_dir = fs.path().join("skills");
    std::fs::create_dir_all(skills_dir.join("brainstorming")).expect("mkdir skill");
    let log_dir = sessions_dir.join("2026/01/28");
    std::fs::create_dir_all(&log_dir).expect("mkdir");
    let workdir = fs.path().join("project");
    std::fs::create_dir_all(&workdir).expect("mkdir2");
    let log_path = log_dir.join("rollout-test.jsonl");

    let line = format!(
        r#"{{"timestamp":"2026-01-28T14:34:27.888Z","type":"response_item","payload":{{"type":"function_call","name":"shell_command","arguments":"{{\"command\":\"~/.codex/superpowers/.codex/superpowers-codex use-skill superpowers:brainstorming\",\"workdir\":\"{}\"}}","call_id":"call_1"}}}}"#,
        workdir.to_string_lossy()
    );
    std::fs::write(&log_path, format!("{}\n", line)).expect("write");

    let stats = scan_codex_sessions_dir(
        &store,
        CodexScanOptions {
            sessions_dir: sessions_dir.clone(),
            skills_dir: skills_dir.clone(),
            now_ms: 123,
            project_mode: ProjectMode::GitRootOrWorkdir,
        },
    )
    .expect("scan");
    assert_eq!(stats.new_events, 1);

    let conn = Connection::open(store.db_path()).expect("open db");
    let stored_key: String = conn
        .query_row(
            "SELECT skill_key FROM skill_usage_events LIMIT 1;",
            [],
            |row| row.get(0),
        )
        .expect("skill_key");
    assert_eq!(stored_key, "brainstorming");
}

#[test]
fn retention_cleanup_deletes_events_older_than_threshold() {
    use rusqlite::Connection;

    let (_dir, store) = make_store();

    // Insert two events with different timestamps.
    let inserted = store
        .insert_skill_usage_event(
            "codex", "my-skill", None, 1, // old
            "/workdir", "/workdir", "/log", 1, 1,
        )
        .expect("insert1");
    assert!(inserted);
    let inserted = store
        .insert_skill_usage_event(
            "codex", "my-skill", None, 10_000, // new
            "/workdir", "/workdir", "/log", 2, 10_000,
        )
        .expect("insert2");
    assert!(inserted);

    // With now_ms=10_000 and retention_days=0, threshold == now_ms.
    let removed =
        cleanup_old_codex_events(&store, /*retention_days*/ 0, /*now_ms*/ 10_000).expect("cleanup");
    assert_eq!(removed, 1);

    let conn = Connection::open(store.db_path()).expect("open db");
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM skill_usage_events;", [], |row| {
            row.get(0)
        })
        .expect("count");
    assert_eq!(count, 1);
}

#[test]
fn clear_deletes_events_and_resets_cursors_to_eof() {
    use rusqlite::Connection;
    use std::io::Write;

    let (_dir, store) = make_store();
    let skill = make_skill("s1", "my-skill", "/central/s1");
    store.upsert_skill(&skill).expect("upsert skill");

    let fs = tempfile::tempdir().expect("tempdir fs");
    let sessions_dir = fs.path().join("sessions");
    let skills_dir = fs.path().join("skills");
    std::fs::create_dir_all(skills_dir.join("my-skill")).expect("mkdir skill");
    let log_dir = sessions_dir.join("2026/01/28");
    std::fs::create_dir_all(&log_dir).expect("mkdir");
    let workdir = fs.path().join("project");
    std::fs::create_dir_all(&workdir).expect("mkdir2");
    let log_path = log_dir.join("rollout-test.jsonl");

    let line = format!(
        r#"{{"timestamp":"2026-01-28T14:34:27.888Z","type":"response_item","payload":{{"type":"function_call","name":"shell_command","arguments":"{{\"command\":\"~/.codex/superpowers/.codex/superpowers-codex use-skill my-skill\",\"workdir\":\"{}\"}}","call_id":"call_1"}}}}"#,
        workdir.to_string_lossy()
    );
    std::fs::write(&log_path, format!("{}\n", line)).expect("write");

    let stats = scan_codex_sessions_dir(
        &store,
        CodexScanOptions {
            sessions_dir: sessions_dir.clone(),
            skills_dir: skills_dir.clone(),
            now_ms: 123,
            project_mode: ProjectMode::GitRootOrWorkdir,
        },
    )
    .expect("scan1");
    assert_eq!(stats.new_events, 1);

    // Append a new line so EOF would be different from cursor.
    std::fs::OpenOptions::new()
        .append(true)
        .open(&log_path)
        .expect("open append")
        .write_all(b"{\"type\":\"noop\"}\n")
        .expect("append");

    let cleared = clear_codex_analytics(&store, &sessions_dir, 999).expect("clear");
    assert_eq!(cleared.deleted_events, 1);

    let conn = Connection::open(store.db_path()).expect("open db");
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM skill_usage_events;", [], |row| {
            row.get(0)
        })
        .expect("count");
    assert_eq!(count, 0);
    let cursor: i64 = conn
        .query_row(
            "SELECT last_line FROM codex_scan_cursors WHERE log_path = ?1;",
            [log_path.to_string_lossy().to_string()],
            |row| row.get(0),
        )
        .expect("cursor");
    assert_eq!(cursor, 2);

    // After clear, we should not re-import past lines.
    let stats = scan_codex_sessions_dir(
        &store,
        CodexScanOptions {
            sessions_dir: sessions_dir.clone(),
            skills_dir: skills_dir.clone(),
            now_ms: 1000,
            project_mode: ProjectMode::GitRootOrWorkdir,
        },
    )
    .expect("scan2");
    assert_eq!(stats.new_events, 0);
}
