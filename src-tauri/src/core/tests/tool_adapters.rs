use std::fs;

use crate::core::tool_adapters::{
    adapter_by_key, adapters_sharing_skills_dir, scan_tool_dir, ToolAdapter, ToolId,
};

#[test]
fn adapter_by_key_finds_known_tool() {
    let a = adapter_by_key("codex").unwrap();
    assert_eq!(a.id, ToolId::Codex);
}

#[test]
fn adapter_by_key_finds_new_tools() {
    assert!(adapter_by_key("kimi_cli").is_some());
    assert!(adapter_by_key("augment").is_some());
    assert!(adapter_by_key("openclaw").is_some());
    assert!(adapter_by_key("command_code").is_some());
    assert!(adapter_by_key("qwen_code").is_some());
}

#[test]
fn adapters_sharing_skills_dir_groups_amp_and_kimi() {
    let amp = adapter_by_key("amp").unwrap();
    let group = adapters_sharing_skills_dir(&amp);
    let keys: std::collections::HashSet<&'static str> =
        group.into_iter().map(|a| a.id.as_key()).collect();
    assert!(keys.contains("amp"));
    assert!(keys.contains("kimi_cli"));
}

#[test]
fn scan_tool_dir_skips_codex_system_and_includes_symlink_dir() {
    let dir = tempfile::tempdir().unwrap();

    fs::create_dir_all(dir.path().join("a")).unwrap();
    fs::create_dir_all(dir.path().join(".system")).unwrap();
    fs::write(dir.path().join("not-a-dir"), b"x").unwrap();

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(dir.path().join("a"), dir.path().join("link-a")).unwrap();
    }

    let tool = ToolAdapter {
        id: ToolId::Codex,
        display_name: "Codex",
        relative_skills_dir: "ignored",
        relative_detect_dir: "ignored",
    };

    let out = scan_tool_dir(&tool, dir.path()).unwrap();
    let names: Vec<String> = out.iter().map(|s| s.name.clone()).collect();

    assert!(names.contains(&"a".to_string()));
    assert!(!names.contains(&".system".to_string()));

    #[cfg(unix)]
    {
        let link = out.iter().find(|s| s.name == "link-a").unwrap();
        assert!(link.is_link);
        assert!(link.link_target.is_some());
    }
}

#[test]
fn scan_tool_dir_skips_app_support_path() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir
        .path()
        .join("Library/Application Support/com.tauri.dev/skills");
    std::fs::create_dir_all(root.join("foo")).unwrap();

    let tool = ToolAdapter {
        id: ToolId::Cursor,
        display_name: "Cursor",
        relative_skills_dir: "ignored",
        relative_detect_dir: "ignored",
    };

    let out = scan_tool_dir(&tool, &root).unwrap();
    assert!(out.is_empty());
}
