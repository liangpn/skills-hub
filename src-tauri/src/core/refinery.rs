use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::Serialize;
use walkdir::{DirEntry, WalkDir};

use super::text_files::read_text_file_utf8;

#[derive(Debug, Clone, Serialize)]
pub struct SkillSnapshotFile {
    pub rel_path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillSnapshot {
    pub root: String,
    pub files: Vec<SkillSnapshotFile>,
    pub truncated: bool,
    pub truncated_reason: Option<String>,
    pub skill_md: Option<String>,
    pub skill_md_error: Option<String>,
}

pub fn read_skill_snapshot(root: &Path, max_files: usize, max_skill_md_bytes: usize) -> Result<SkillSnapshot> {
    if !root.exists() {
        anyhow::bail!("snapshot root not found: {:?}", root);
    }
    if !root.is_dir() {
        anyhow::bail!("snapshot root is not a directory: {:?}", root);
    }

    let mut files: Vec<SkillSnapshotFile> = Vec::new();
    let mut truncated = false;
    let mut truncated_reason: Option<String> = None;

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !should_skip_snapshot_entry(e))
    {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        if files.len() >= max_files {
            truncated = true;
            truncated_reason = Some(format!("file list truncated at {} files", max_files));
            break;
        }
        let p = entry.path();
        let rel = p.strip_prefix(root).unwrap_or(p);
        files.push(SkillSnapshotFile {
            rel_path: normalize_rel_path(rel),
            size: entry.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

    let (skill_md, skill_md_error) = read_skill_md(root, max_skill_md_bytes);

    Ok(SkillSnapshot {
        root: root.to_string_lossy().to_string(),
        files,
        truncated,
        truncated_reason,
        skill_md,
        skill_md_error,
    })
}

fn should_skip_snapshot_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    if !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    matches!(
        name.as_ref(),
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "out"
            | ".next"
            | ".turbo"
            | ".cache"
            | ".idea"
            | ".vscode"
            | ".venv"
            | "__pycache__"
            | "coverage"
    )
}

fn read_skill_md(root: &Path, max_bytes: usize) -> (Option<String>, Option<String>) {
    let p = root.join("SKILL.md");
    if !p.exists() {
        return (None, None);
    }
    match read_text_file_utf8(&p, max_bytes) {
        Ok(s) => (Some(s), None),
        Err(err) => (None, Some(format!("{:#}", err))),
    }
}

fn normalize_rel_path(path: &Path) -> String {
    let normalized: PathBuf = path.components().collect();
    normalized.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn snapshot_reads_files_and_skill_md() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("SKILL.md"), "---\nname: x\n---\n").unwrap();
        fs::write(dir.path().join("a.txt"), "a").unwrap();
        fs::create_dir_all(dir.path().join("refs")).unwrap();
        fs::write(dir.path().join("refs/b.md"), "b").unwrap();

        let snap = read_skill_snapshot(dir.path(), 100, 1024).unwrap();
        assert_eq!(snap.skill_md.as_deref(), Some("---\nname: x\n---\n"));
        assert!(snap.files.iter().any(|f| f.rel_path == "SKILL.md"));
        assert!(snap.files.iter().any(|f| f.rel_path == "a.txt"));
        assert!(snap.files.iter().any(|f| f.rel_path == "refs/b.md"));
    }

    #[test]
    fn snapshot_records_skill_md_error() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("SKILL.md"), vec![b'a'; 10]).unwrap();
        let snap = read_skill_snapshot(dir.path(), 100, 5).unwrap();
        assert!(snap.skill_md.is_none());
        assert!(snap.skill_md_error.unwrap_or_default().contains("file too large"));
    }

    #[test]
    fn snapshot_truncates_when_too_many_files() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..3 {
            fs::write(dir.path().join(format!("{i}.txt")), "x").unwrap();
        }
        let snap = read_skill_snapshot(dir.path(), 2, 1024).unwrap();
        assert_eq!(snap.files.len(), 2);
        assert!(snap.truncated);
    }

    #[test]
    fn snapshot_skips_common_vendor_dirs() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "a").unwrap();
        fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        fs::write(dir.path().join("node_modules/pkg/index.js"), "x").unwrap();

        let snap = read_skill_snapshot(dir.path(), 100, 1024).unwrap();
        assert!(snap.files.iter().any(|f| f.rel_path == "a.txt"));
        assert!(!snap.files.iter().any(|f| f.rel_path.contains("node_modules")));
    }
}
