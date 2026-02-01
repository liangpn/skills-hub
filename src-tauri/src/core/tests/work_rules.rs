use std::fs;
use std::path::Path;

use crate::core::work_rules::{
    create_work_rule_in_root, export_work_rule_to_project, get_work_rule_in_root,
    list_work_rules_in_root, update_work_rule_in_root, ExportMode, WorkRuleCreateParams,
    WorkRuleUpdateParams,
};

#[test]
fn list_work_rules_reads_manifest() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".work-rules");
    fs::create_dir_all(&root).unwrap();

    let asset_dir = root.join("my-rule");
    fs::create_dir_all(&asset_dir).unwrap();
    fs::write(
        asset_dir.join("manifest.json"),
        r#"{"version":1,"kind":"work_rule","name":"my-rule","entry_file":"AGENTS.md","tags":["a"],"score":5,"description":"d","created_at_ms":1,"updated_at_ms":2}"#,
    )
    .unwrap();
    fs::write(asset_dir.join("AGENTS.md"), "# hi").unwrap();

    let list = list_work_rules_in_root(&root).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "my-rule");
    assert_eq!(list[0].entry_file, "AGENTS.md");
    assert_eq!(list[0].tags, vec!["a".to_string()]);
    assert_eq!(list[0].score, Some(5.0));
}

#[test]
fn create_work_rule_writes_manifest_and_entry() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".work-rules");
    fs::create_dir_all(&root).unwrap();

    create_work_rule_in_root(
        &root,
        WorkRuleCreateParams {
            name: "rule-1".to_string(),
            entry_file: "AGENTS.md".to_string(),
            content: "# hello".to_string(),
            tags: vec!["tag1".to_string()],
            score: Some(10.0),
            description: Some("desc".to_string()),
            now_ms: 123,
        },
    )
    .unwrap();

    assert!(root.join("rule-1").join("manifest.json").exists());
    assert_eq!(fs::read_to_string(root.join("rule-1").join("AGENTS.md")).unwrap(), "# hello");
}

#[test]
fn export_work_rule_copy_writes_file() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".work-rules");
    fs::create_dir_all(&root).unwrap();

    create_work_rule_in_root(
        &root,
        WorkRuleCreateParams {
            name: "rule-1".to_string(),
            entry_file: "AGENTS.md".to_string(),
            content: "# hello".to_string(),
            tags: vec![],
            score: None,
            description: None,
            now_ms: 1,
        },
    )
    .unwrap();

    let project_dir = temp.path().join("proj");
    fs::create_dir_all(&project_dir).unwrap();

    export_work_rule_to_project(
        &root,
        Path::new("rule-1"),
        &project_dir,
        "AGENTS.md",
        ExportMode::Copy,
        false,
    )
    .unwrap();

    assert_eq!(fs::read_to_string(project_dir.join("AGENTS.md")).unwrap(), "# hello");
}

#[test]
fn get_work_rule_reads_manifest_and_entry() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".work-rules");
    fs::create_dir_all(&root).unwrap();

    create_work_rule_in_root(
        &root,
        WorkRuleCreateParams {
            name: "rule-1".to_string(),
            entry_file: "AGENTS.md".to_string(),
            content: "# hello".to_string(),
            tags: vec!["t".to_string()],
            score: Some(9.3),
            description: Some("d".to_string()),
            now_ms: 10,
        },
    )
    .unwrap();

    let (manifest, content) = get_work_rule_in_root(&root, "rule-1", 1024).unwrap();
    assert_eq!(manifest.name, "rule-1");
    assert_eq!(manifest.entry_file, "AGENTS.md");
    assert_eq!(manifest.tags, vec!["t".to_string()]);
    assert_eq!(manifest.score, Some(9.3));
    assert_eq!(content, "# hello");
}

#[test]
fn update_work_rule_updates_manifest_and_entry() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".work-rules");
    fs::create_dir_all(&root).unwrap();

    create_work_rule_in_root(
        &root,
        WorkRuleCreateParams {
            name: "rule-1".to_string(),
            entry_file: "AGENTS.md".to_string(),
            content: "# hello".to_string(),
            tags: vec![],
            score: None,
            description: None,
            now_ms: 10,
        },
    )
    .unwrap();

    update_work_rule_in_root(
        &root,
        "rule-1",
        WorkRuleUpdateParams {
            entry_file: "RULES.md".to_string(),
            content: "# updated".to_string(),
            tags: vec!["a".to_string(), "b".to_string()],
            score: Some(8.5),
            description: Some("desc".to_string()),
            now_ms: 20,
        },
    )
    .unwrap();

    assert!(root.join("rule-1").join("RULES.md").exists());
    assert!(!root.join("rule-1").join("AGENTS.md").exists());

    let (manifest, content) = get_work_rule_in_root(&root, "rule-1", 1024).unwrap();
    assert_eq!(manifest.entry_file, "RULES.md");
    assert_eq!(manifest.tags, vec!["a".to_string(), "b".to_string()]);
    assert_eq!(manifest.score, Some(8.5));
    assert_eq!(manifest.description.as_deref(), Some("desc"));
    assert_eq!(manifest.created_at_ms, 10);
    assert_eq!(manifest.updated_at_ms, 20);
    assert_eq!(content, "# updated");
}
