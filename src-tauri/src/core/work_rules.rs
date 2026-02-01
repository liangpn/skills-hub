use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use super::text_files::read_text_file_utf8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkRuleManifest {
    pub version: i32,
    pub kind: String,
    pub name: String,
    pub entry_file: String,
    pub tags: Vec<String>,
    pub score: Option<f64>,
    pub description: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkRuleEntry {
    pub name: String,
    pub entry_file: String,
    pub tags: Vec<String>,
    pub score: Option<f64>,
    pub description: Option<String>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct WorkRuleCreateParams {
    pub name: String,
    pub entry_file: String,
    pub content: String,
    pub tags: Vec<String>,
    pub score: Option<f64>,
    pub description: Option<String>,
    pub now_ms: i64,
}

#[derive(Debug, Clone)]
pub struct WorkRuleUpdateParams {
    pub entry_file: String,
    pub content: String,
    pub tags: Vec<String>,
    pub score: Option<f64>,
    pub description: Option<String>,
    pub now_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportMode {
    Copy,
    Symlink,
}

pub fn list_work_rules_in_root(root: &Path) -> Result<Vec<WorkRuleEntry>> {
    let mut out = Vec::new();
    if !root.exists() {
        return Ok(out);
    }

    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let dir_path = entry.path();
        let manifest_path = dir_path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        let raw = match std::fs::read_to_string(&manifest_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let manifest: WorkRuleManifest = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if manifest.kind != "work_rule" {
            continue;
        }
        out.push(WorkRuleEntry {
            name: manifest.name,
            entry_file: manifest.entry_file,
            tags: manifest.tags,
            score: manifest.score,
            description: manifest.description,
            updated_at_ms: manifest.updated_at_ms,
        });
    }

    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

pub fn create_work_rule_in_root(root: &Path, params: WorkRuleCreateParams) -> Result<()> {
    ensure_safe_segment(&params.name)?;
    ensure_safe_file_name(&params.entry_file)?;

    let asset_dir = root.join(&params.name);
    if asset_dir.exists() {
        anyhow::bail!("work rule already exists: {}", params.name);
    }
    std::fs::create_dir_all(&asset_dir)?;

    std::fs::write(asset_dir.join(&params.entry_file), params.content)?;

    let manifest = WorkRuleManifest {
        version: 1,
        kind: "work_rule".to_string(),
        name: params.name,
        entry_file: params.entry_file,
        tags: params.tags,
        score: params.score,
        description: params.description,
        created_at_ms: params.now_ms,
        updated_at_ms: params.now_ms,
    };
    std::fs::write(
        asset_dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest)?,
    )?;

    Ok(())
}

pub fn get_work_rule_in_root(
    root: &Path,
    name: &str,
    max_entry_bytes: usize,
) -> Result<(WorkRuleManifest, String)> {
    ensure_safe_segment(name)?;
    let asset_dir = root.join(name);
    let manifest_path = asset_dir.join("manifest.json");
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|e| anyhow::anyhow!("read manifest {:?}: {}", manifest_path, e))?;
    let manifest: WorkRuleManifest = serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("parse manifest {:?}: {}", manifest_path, e))?;
    if manifest.kind != "work_rule" {
        anyhow::bail!("invalid work rule kind");
    }

    let entry_path = asset_dir.join(&manifest.entry_file);
    let content = read_text_file_utf8(&entry_path, max_entry_bytes)?;

    Ok((manifest, content))
}

pub fn update_work_rule_in_root(root: &Path, name: &str, params: WorkRuleUpdateParams) -> Result<()> {
    ensure_safe_segment(name)?;
    ensure_safe_file_name(&params.entry_file)?;

    let asset_dir = root.join(name);
    let manifest_path = asset_dir.join("manifest.json");
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|e| anyhow::anyhow!("read manifest {:?}: {}", manifest_path, e))?;
    let mut manifest: WorkRuleManifest = serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("parse manifest {:?}: {}", manifest_path, e))?;
    if manifest.kind != "work_rule" {
        anyhow::bail!("invalid work rule kind");
    }

    let old_entry = manifest.entry_file.clone();
    if old_entry != params.entry_file {
        ensure_safe_file_name(&old_entry)?;
        let old_path = asset_dir.join(&old_entry);
        if old_path.exists() {
            std::fs::remove_file(&old_path)?;
        }
    }

    std::fs::write(asset_dir.join(&params.entry_file), params.content)?;

    manifest.entry_file = params.entry_file;
    manifest.tags = params.tags;
    manifest.score = params.score;
    manifest.description = params.description;
    manifest.updated_at_ms = params.now_ms;

    std::fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)?;

    Ok(())
}

pub fn export_work_rule_to_project(
    root: &Path,
    work_rule_dir_name: &Path,
    project_dir: &Path,
    dest_file_name: &str,
    mode: ExportMode,
    overwrite: bool,
) -> Result<PathBuf> {
    ensure_safe_relative_path(work_rule_dir_name)?;
    ensure_safe_file_name(dest_file_name)?;

    let asset_dir = root.join(work_rule_dir_name);
    let manifest_path = asset_dir.join("manifest.json");
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|e| anyhow::anyhow!("read manifest {:?}: {}", manifest_path, e))?;
    let manifest: WorkRuleManifest = serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("parse manifest {:?}: {}", manifest_path, e))?;

    let src_path = asset_dir.join(&manifest.entry_file);
    let dest_path = project_dir.join(dest_file_name);

    if dest_path.exists() {
        if overwrite {
            if dest_path.is_dir() {
                std::fs::remove_dir_all(&dest_path)?;
            } else {
                std::fs::remove_file(&dest_path)?;
            }
        } else {
            anyhow::bail!("target already exists: {:?}", dest_path);
        }
    }

    match mode {
        ExportMode::Copy => {
            std::fs::create_dir_all(project_dir)?;
            std::fs::copy(&src_path, &dest_path)?;
        }
        ExportMode::Symlink => {
            std::fs::create_dir_all(project_dir)?;
            create_file_symlink(&src_path, &dest_path)?;
        }
    }

    Ok(dest_path)
}

fn ensure_safe_segment(s: &str) -> Result<()> {
    if s.trim().is_empty() {
        anyhow::bail!("name is empty");
    }
    if s.contains(['/', '\\']) {
        anyhow::bail!("invalid name: contains path separators");
    }
    if s.contains('\0') {
        anyhow::bail!("invalid name");
    }
    Ok(())
}

fn ensure_safe_file_name(name: &str) -> Result<()> {
    let p = Path::new(name);
    ensure_safe_relative_path(p)?;
    let mut iter = p.components();
    let Some(first) = iter.next() else {
        anyhow::bail!("invalid file name");
    };
    if iter.next().is_some() {
        anyhow::bail!("invalid file name: must not contain path separators");
    }
    if !matches!(first, std::path::Component::Normal(_)) {
        anyhow::bail!("invalid file name");
    }
    Ok(())
}

fn ensure_safe_relative_path(path: &Path) -> Result<()> {
    if path.is_absolute() {
        anyhow::bail!("invalid path");
    }
    for component in path.components() {
        if matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::RootDir
        ) {
            anyhow::bail!("invalid path");
        }
        if matches!(component, std::path::Component::Prefix(_)) {
            anyhow::bail!("invalid path");
        }
    }
    Ok(())
}

fn create_file_symlink(src: &Path, dst: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(src, dst)?;
        return Ok(());
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(src, dst)?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg(test)]
#[path = "tests/work_rules.rs"]
mod tests;
