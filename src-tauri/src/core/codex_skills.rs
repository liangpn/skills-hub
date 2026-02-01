use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct CodexInstalledSkill {
    pub name: String,
    pub path: PathBuf,
    pub is_system: bool,
}

pub fn list_codex_installed_skills_in_dir(skills_root: &Path) -> Result<Vec<CodexInstalledSkill>> {
    if !skills_root.exists() {
        return Ok(Vec::new());
    }
    if !skills_root.is_dir() {
        anyhow::bail!("skills root is not a directory: {:?}", skills_root);
    }

    let mut out = Vec::new();
    for entry in std::fs::read_dir(skills_root).with_context(|| format!("read dir {:?}", skills_root))? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let is_dir = file_type.is_dir() || (file_type.is_symlink() && path.is_dir());
        if !is_dir {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".system" {
            out.extend(list_codex_system_skills(&path)?);
            continue;
        }
        if name.starts_with('.') {
            continue;
        }

        out.push(CodexInstalledSkill {
            name,
            path,
            is_system: false,
        });
    }

    out.sort_by(|a, b| {
        a.is_system
            .cmp(&b.is_system)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(out)
}

fn list_codex_system_skills(system_root: &Path) -> Result<Vec<CodexInstalledSkill>> {
    if !system_root.exists() {
        return Ok(Vec::new());
    }
    if !system_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for entry in std::fs::read_dir(system_root).with_context(|| format!("read dir {:?}", system_root))? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let is_dir = file_type.is_dir() || (file_type.is_symlink() && path.is_dir());
        if !is_dir {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        out.push(CodexInstalledSkill {
            name,
            path,
            is_system: true,
        });
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn lists_codex_skills_and_system_skills() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join(".codex/skills");
        fs::create_dir_all(root.join("foo")).unwrap();
        fs::create_dir_all(root.join(".system/skill-creator")).unwrap();
        fs::create_dir_all(root.join(".system/skill-installer")).unwrap();
        fs::create_dir_all(root.join(".hidden-skip")).unwrap();
        fs::write(root.join("foo/SKILL.md"), "x").unwrap();

        let list = list_codex_installed_skills_in_dir(&root).unwrap();
        assert!(list.iter().any(|s| s.name == "foo" && !s.is_system));
        assert!(list
            .iter()
            .any(|s| s.name == "skill-creator" && s.is_system));
        assert!(list
            .iter()
            .any(|s| s.name == "skill-installer" && s.is_system));
        assert!(!list.iter().any(|s| s.name.contains("hidden")));
    }
}

