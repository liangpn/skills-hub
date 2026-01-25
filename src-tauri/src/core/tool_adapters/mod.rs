use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolId {
    Cursor,
    ClaudeCode,
    Codex,
    OpenCode,
    Antigravity,
    Amp,
    KiloCode,
    RooCode,
    Goose,
    GeminiCli,
    GithubCopilot,
    Clawdbot,
    Droid,
    Windsurf,
}

impl ToolId {
    pub fn as_key(&self) -> &'static str {
        match self {
            ToolId::Cursor => "cursor",
            ToolId::ClaudeCode => "claude_code",
            ToolId::Codex => "codex",
            ToolId::OpenCode => "opencode",
            ToolId::Antigravity => "antigravity",
            ToolId::Amp => "amp",
            ToolId::KiloCode => "kilo_code",
            ToolId::RooCode => "roo_code",
            ToolId::Goose => "goose",
            ToolId::GeminiCli => "gemini_cli",
            ToolId::GithubCopilot => "github_copilot",
            ToolId::Clawdbot => "clawdbot",
            ToolId::Droid => "droid",
            ToolId::Windsurf => "windsurf",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ToolAdapter {
    pub id: ToolId,
    pub display_name: &'static str,
    /// Global skill directory under user home (aligned with add-skill docs).
    pub relative_skills_dir: &'static str,
    /// Directory used to detect whether the tool is installed (aligned with add-skill docs).
    pub relative_detect_dir: &'static str,
}

#[derive(Clone, Debug)]
pub struct DetectedSkill {
    pub tool: ToolId,
    pub name: String,
    pub path: PathBuf,
    pub is_link: bool,
    pub link_target: Option<PathBuf>,
}

pub fn default_tool_adapters() -> Vec<ToolAdapter> {
    vec![
        ToolAdapter {
            id: ToolId::Cursor,
            display_name: "Cursor",
            relative_skills_dir: ".cursor/skills",
            relative_detect_dir: ".cursor",
        },
        ToolAdapter {
            id: ToolId::ClaudeCode,
            display_name: "Claude Code",
            relative_skills_dir: ".claude/skills",
            relative_detect_dir: ".claude",
        },
        ToolAdapter {
            id: ToolId::Codex,
            display_name: "Codex",
            relative_skills_dir: ".codex/skills",
            relative_detect_dir: ".codex",
        },
        ToolAdapter {
            id: ToolId::OpenCode,
            display_name: "OpenCode",
            // add-skill global path: ~/.config/opencode/skill/
            relative_skills_dir: ".config/opencode/skill",
            relative_detect_dir: ".config/opencode",
        },
        ToolAdapter {
            id: ToolId::Antigravity,
            display_name: "Antigravity",
            // add-skill global path: ~/.gemini/antigravity/skills/
            relative_skills_dir: ".gemini/antigravity/skills",
            relative_detect_dir: ".gemini/antigravity",
        },
        ToolAdapter {
            id: ToolId::Amp,
            display_name: "Amp",
            // add-skill global path: ~/.config/agents/skills/
            relative_skills_dir: ".config/agents/skills",
            relative_detect_dir: ".config/agents",
        },
        ToolAdapter {
            id: ToolId::KiloCode,
            display_name: "Kilo Code",
            // add-skill global path: ~/.kilocode/skills/
            relative_skills_dir: ".kilocode/skills",
            relative_detect_dir: ".kilocode",
        },
        ToolAdapter {
            id: ToolId::RooCode,
            display_name: "Roo Code",
            // add-skill global path: ~/.roo/skills/
            relative_skills_dir: ".roo/skills",
            relative_detect_dir: ".roo",
        },
        ToolAdapter {
            id: ToolId::Goose,
            display_name: "Goose",
            // add-skill global path: ~/.config/goose/skills/
            relative_skills_dir: ".config/goose/skills",
            relative_detect_dir: ".config/goose",
        },
        ToolAdapter {
            id: ToolId::GeminiCli,
            display_name: "Gemini CLI",
            // add-skill global path: ~/.gemini/skills/
            relative_skills_dir: ".gemini/skills",
            relative_detect_dir: ".gemini",
        },
        ToolAdapter {
            id: ToolId::GithubCopilot,
            display_name: "GitHub Copilot",
            // add-skill global path: ~/.copilot/skills/
            relative_skills_dir: ".copilot/skills",
            relative_detect_dir: ".copilot",
        },
        ToolAdapter {
            id: ToolId::Clawdbot,
            display_name: "Clawdbot",
            // add-skill global path: ~/.clawdbot/skills/
            relative_skills_dir: ".clawdbot/skills",
            relative_detect_dir: ".clawdbot",
        },
        ToolAdapter {
            id: ToolId::Droid,
            display_name: "Droid",
            // add-skill global path: ~/.factory/skills/
            relative_skills_dir: ".factory/skills",
            relative_detect_dir: ".factory",
        },
        ToolAdapter {
            id: ToolId::Windsurf,
            display_name: "Windsurf",
            // add-skill global path: ~/.codeium/windsurf/skills/
            relative_skills_dir: ".codeium/windsurf/skills",
            relative_detect_dir: ".codeium/windsurf",
        },
    ]
}

pub fn adapter_by_key(key: &str) -> Option<ToolAdapter> {
    default_tool_adapters()
        .into_iter()
        .find(|adapter| adapter.id.as_key() == key)
}

pub fn resolve_default_path(adapter: &ToolAdapter) -> Result<PathBuf> {
    let home = dirs::home_dir().context("failed to resolve home directory")?;
    Ok(home.join(adapter.relative_skills_dir))
}

pub fn resolve_detect_path(adapter: &ToolAdapter) -> Result<PathBuf> {
    let home = dirs::home_dir().context("failed to resolve home directory")?;
    Ok(home.join(adapter.relative_detect_dir))
}

pub fn is_tool_installed(adapter: &ToolAdapter) -> Result<bool> {
    Ok(resolve_detect_path(adapter)?.exists())
}

pub fn scan_tool_dir(tool: &ToolAdapter, dir: &Path) -> Result<Vec<DetectedSkill>> {
    let mut results = Vec::new();
    if !dir.exists() {
        return Ok(results);
    }

    let ignore_hint = "Application Support/com.tauri.dev/skills";

    for entry in std::fs::read_dir(dir).with_context(|| format!("read dir {:?}", dir))? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let is_dir = file_type.is_dir() || (file_type.is_symlink() && path.is_dir());
        if !is_dir {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if tool.id == ToolId::Codex && name == ".system" {
            continue;
        }
        let (is_link, link_target) = detect_link(&path);
        if path.to_string_lossy().contains(ignore_hint)
            || link_target
                .as_ref()
                .map(|p| p.to_string_lossy().contains(ignore_hint))
                .unwrap_or(false)
        {
            continue;
        }
        results.push(DetectedSkill {
            tool: tool.id.clone(),
            name,
            path,
            is_link,
            link_target,
        });
    }

    Ok(results)
}

fn detect_link(path: &Path) -> (bool, Option<PathBuf>) {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let target = std::fs::read_link(path).ok();
            (true, target)
        }
        _ => {
            let target = std::fs::read_link(path).ok();
            if target.is_some() {
                (true, target)
            } else {
                (false, None)
            }
        }
    }
}

#[cfg(test)]
#[path = "../tests/tool_adapters.rs"]
mod tests;
