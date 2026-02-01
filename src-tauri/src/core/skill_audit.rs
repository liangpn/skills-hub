use std::path::{Path, PathBuf};

use anyhow::Result;

use super::refinery::{read_skill_snapshot, SkillSnapshot};
use super::text_files::read_text_file_utf8;

const DEFAULT_MAX_FILES: usize = 2000;
const DEFAULT_MAX_SKILL_MD_BYTES: usize = 256 * 1024;
const DEFAULT_MAX_FILE_BYTES: usize = 128 * 1024;
const DEFAULT_MAX_TOTAL_BYTES: usize = 512 * 1024;

pub fn build_skill_audit_source_md(root: &Path) -> Result<String> {
    let snapshot = read_skill_snapshot(root, DEFAULT_MAX_FILES, DEFAULT_MAX_SKILL_MD_BYTES)?;
    build_skill_audit_source_md_from_snapshot(root, &snapshot)
}

fn build_skill_audit_source_md_from_snapshot(root: &Path, snapshot: &SkillSnapshot) -> Result<String> {
    let mut out = String::new();
    out.push_str("# Skill Audit Input\n\n");
    out.push_str(&format!("Root: `{}`\n\n", snapshot.root));

    out.push_str("## Directory Tree\n\n```text\n");
    out.push_str(&build_tree(&snapshot.files));
    out.push_str("\n```\n\n");

    if snapshot.truncated {
        out.push_str(&format!(
            "> Note: file list truncated. {}\n\n",
            snapshot.truncated_reason.clone().unwrap_or_default()
        ));
    }

    // Always include SKILL.md first if present.
    if let Some(text) = snapshot.skill_md.as_deref() {
        out.push_str("## File: SKILL.md\n\n```markdown\n");
        out.push_str(text.trim_end());
        out.push_str("\n```\n\n");
    } else if let Some(err) = snapshot.skill_md_error.as_deref() {
        out.push_str(&format!(
            "## File: SKILL.md\n\n> Failed to read SKILL.md: {}\n\n",
            err.trim()
        ));
    } else {
        out.push_str("## File: SKILL.md\n\n> SKILL.md not found.\n\n");
    }

    let mut included_bytes = out.len();
    for f in &snapshot.files {
        if f.rel_path == "SKILL.md" {
            continue;
        }
        if !should_include_file(&f.rel_path) {
            continue;
        }
        if included_bytes >= DEFAULT_MAX_TOTAL_BYTES {
            out.push_str("> Note: remaining files omitted due to total size limit.\n");
            break;
        }

        let p = root.join(&f.rel_path);
        let language = guess_code_fence_lang(&f.rel_path);
        out.push_str(&format!("## File: {}\n\n```{}\n", f.rel_path, language));
        match read_text_file_utf8(&p, DEFAULT_MAX_FILE_BYTES) {
            Ok(text) => {
                let trimmed = text.trim_end();
                out.push_str(trimmed);
                out.push_str("\n```\n\n");
                included_bytes = out.len();
            }
            Err(err) => {
                out.push_str(&format!(
                    "[unreadable file: {}]\n```\n\n",
                    format!("{:#}", err).trim()
                ));
            }
        }
    }

    Ok(out)
}

fn build_tree(files: &[super::refinery::SkillSnapshotFile]) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

    for f in files {
        let rel = f.rel_path.trim_matches('/');
        if rel.is_empty() {
            continue;
        }

        let parts: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
        for i in 0..parts.len() {
            let seg = parts[i];
            let key = parts[..=i].join("/");
            if !seen.insert(key) {
                continue;
            }

            let is_dir = i + 1 < parts.len();
            let indent = "  ".repeat(i);
            if is_dir {
                lines.push(format!("{}{}{}", indent, seg, "/"));
            } else {
                lines.push(format!("{}{}", indent, seg));
            }
        }
    }

    lines.join("\n")
}

fn should_include_file(rel_path: &str) -> bool {
    let path = rel_path.trim().to_lowercase();
    if path.ends_with(".md") || path.ends_with(".txt") || path.ends_with(".toml") {
        return true;
    }
    if path.ends_with(".yml")
        || path.ends_with(".yaml")
        || path.ends_with(".json")
        || path.ends_with(".sh")
        || path.ends_with(".bash")
        || path.ends_with(".zsh")
        || path.ends_with(".ps1")
        || path.ends_with(".py")
        || path.ends_with(".js")
        || path.ends_with(".ts")
        || path.ends_with(".jsx")
        || path.ends_with(".tsx")
        || path.ends_with(".rs")
        || path.ends_with(".go")
        || path.ends_with(".rb")
        || path.ends_with(".php")
    {
        return true;
    }
    // Common config files without extensions.
    matches!(
        PathBuf::from(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(""),
        "readme"
            | "license"
            | "makefile"
            | "dockerfile"
            | "agents.md"
            | "skill.md"
            | "prompt.md"
    )
}

fn guess_code_fence_lang(rel_path: &str) -> &'static str {
    let lower = rel_path.to_lowercase();
    if lower.ends_with(".md") {
        return "markdown";
    }
    if lower.ends_with(".toml") {
        return "toml";
    }
    if lower.ends_with(".yml") || lower.ends_with(".yaml") {
        return "yaml";
    }
    if lower.ends_with(".json") {
        return "json";
    }
    if lower.ends_with(".sh") || lower.ends_with(".bash") || lower.ends_with(".zsh") {
        return "bash";
    }
    if lower.ends_with(".ps1") {
        return "powershell";
    }
    if lower.ends_with(".py") {
        return "python";
    }
    if lower.ends_with(".ts") || lower.ends_with(".tsx") {
        return "typescript";
    }
    if lower.ends_with(".js") || lower.ends_with(".jsx") {
        return "javascript";
    }
    if lower.ends_with(".rs") {
        return "rust";
    }
    if lower.ends_with(".go") {
        return "go";
    }
    if lower.ends_with(".rb") {
        return "ruby";
    }
    if lower.ends_with(".php") {
        return "php";
    }
    ""
}
