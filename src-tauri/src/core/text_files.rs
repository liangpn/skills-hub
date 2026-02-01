use std::path::Path;

use anyhow::{Context, Result};

pub fn read_text_file_utf8(path: &Path, max_bytes: usize) -> Result<String> {
    let metadata = std::fs::metadata(path).with_context(|| format!("stat {:?}", path))?;
    if !metadata.is_file() {
        anyhow::bail!("not a file: {:?}", path);
    }
    if metadata.len() as usize > max_bytes {
        anyhow::bail!("file too large: {} bytes", metadata.len());
    }
    let bytes = std::fs::read(path).with_context(|| format!("read {:?}", path))?;
    if bytes.len() > max_bytes {
        anyhow::bail!("file too large: {} bytes", bytes.len());
    }
    String::from_utf8(bytes).context("file is not valid UTF-8")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_small_utf8_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, "hello").unwrap();

        let got = read_text_file_utf8(&p, 1024).unwrap();
        assert_eq!(got, "hello");
    }

    #[test]
    fn rejects_large_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.txt");
        fs::write(&p, vec![b'a'; 10]).unwrap();

        let err = read_text_file_utf8(&p, 5).unwrap_err();
        assert!(format!("{:#}", err).contains("file too large"));
    }

    #[test]
    fn rejects_non_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bin.bin");
        fs::write(&p, vec![0xff, 0xfe, 0xfd]).unwrap();

        let err = read_text_file_utf8(&p, 1024).unwrap_err();
        assert!(format!("{:#}", err).to_lowercase().contains("utf"));
    }
}

