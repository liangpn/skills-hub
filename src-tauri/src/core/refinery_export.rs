use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

pub fn export_skill_to_root(
    root: &Path,
    name: &str,
    skill_md: &str,
    overwrite: bool,
) -> Result<PathBuf> {
    ensure_safe_segment(name)?;

    std::fs::create_dir_all(root).with_context(|| format!("create {:?}", root))?;
    let dest_dir = root.join(name);

    if dest_dir.exists() {
        if overwrite {
            std::fs::remove_dir_all(&dest_dir).with_context(|| format!("remove {:?}", dest_dir))?;
        } else {
            anyhow::bail!("target already exists: {:?}", dest_dir);
        }
    }

    std::fs::create_dir_all(&dest_dir).with_context(|| format!("create {:?}", dest_dir))?;
    std::fs::write(dest_dir.join("SKILL.md"), skill_md).with_context(|| "write SKILL.md")?;

    Ok(dest_dir)
}

fn ensure_safe_segment(s: &str) -> Result<()> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        anyhow::bail!("name is empty");
    }
    if trimmed.starts_with('.') {
        anyhow::bail!("invalid name: must not start with '.'");
    }
    if trimmed.contains(['/', '\\']) {
        anyhow::bail!("invalid name: contains path separators");
    }
    if trimmed.contains('\0') {
        anyhow::bail!("invalid name");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn exports_skill_to_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("skills");
        let dest = export_skill_to_root(&root, "foo", "---\nname: foo\n---\n", false).unwrap();
        assert_eq!(dest, root.join("foo"));
        assert!(dest.join("SKILL.md").exists());
        let content = fs::read_to_string(dest.join("SKILL.md")).unwrap();
        assert!(content.contains("name: foo"));
    }

    #[test]
    fn export_fails_when_target_exists_without_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("skills");
        let _ = export_skill_to_root(&root, "foo", "x", false).unwrap();
        let err = export_skill_to_root(&root, "foo", "y", false).unwrap_err();
        assert!(format!("{:#}", err).contains("target already exists"));
    }

    #[test]
    fn export_overwrites_when_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("skills");
        let _ = export_skill_to_root(&root, "foo", "x", false).unwrap();
        let dest = export_skill_to_root(&root, "foo", "y", true).unwrap();
        let content = fs::read_to_string(dest.join("SKILL.md")).unwrap();
        assert_eq!(content, "y");
    }
}

