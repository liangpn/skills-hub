use std::path::{Path, PathBuf};

/// Best-effort `.env` loader (stdlib-only).
///
/// - Does not override existing environment variables.
/// - Ignores blank lines and comments starting with `#`.
/// - Accepts `KEY=VALUE` with optional single/double quotes for VALUE.
pub fn load_dotenv_if_present() {
    for path in dotenv_candidate_paths() {
        if path.exists() {
            let _ = load_dotenv_file(&path);
            // Stop at first readable .env to keep behavior predictable.
            break;
        }
    }
}

fn dotenv_candidate_paths() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    dotenv_candidate_paths_for_home(&home)
}

fn dotenv_candidate_paths_for_home(home: &Path) -> Vec<PathBuf> {
    vec![home.join(".work-rules").join(".env")]
}

fn load_dotenv_file(path: &Path) -> std::io::Result<()> {
    let content = std::fs::read_to_string(path)?;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        if std::env::var_os(key).is_some() {
            continue;
        }
        let mut value = value.trim().to_string();
        if (value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\''))
        {
            value = value[1..value.len().saturating_sub(1)].to_string();
        }
        std::env::set_var(key, value);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn dotenv_path_is_work_rules_only() {
        let home = PathBuf::from("/tmp/home");
        let paths = dotenv_candidate_paths_for_home(&home);
        assert_eq!(paths, vec![home.join(".work-rules").join(".env")]);
    }

    #[test]
    fn parses_simple_dotenv() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(".env");
        fs::write(
            &p,
            r#"
# comment
OPENAI_API_KEY=abc
FOO="bar"
BAZ='qux'
"#,
        )
        .unwrap();

        std::env::remove_var("OPENAI_API_KEY");
        std::env::remove_var("FOO");
        std::env::remove_var("BAZ");

        load_dotenv_file(&p).unwrap();

        assert_eq!(std::env::var("OPENAI_API_KEY").unwrap(), "abc");
        assert_eq!(std::env::var("FOO").unwrap(), "bar");
        assert_eq!(std::env::var("BAZ").unwrap(), "qux");
    }
}
