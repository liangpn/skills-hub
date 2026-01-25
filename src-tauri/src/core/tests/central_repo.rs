use std::path::PathBuf;

use crate::core::central_repo::{ensure_central_repo, resolve_central_repo_path};
use crate::core::skill_store::SkillStore;

fn make_store() -> (tempfile::TempDir, SkillStore) {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = SkillStore::new(dir.path().join("test.db"));
    store.ensure_schema().expect("ensure_schema");
    (dir, store)
}

#[test]
fn resolve_uses_setting_when_present() {
    let (dir, store) = make_store();
    let app = tauri::test::mock_app();
    let expected = dir.path().join("central");
    store
        .set_setting("central_repo_path", expected.to_string_lossy().as_ref())
        .unwrap();

    let got = resolve_central_repo_path(app.handle(), &store).unwrap();
    assert_eq!(got, expected);
}

#[test]
fn ensure_central_repo_creates_dir() {
    let dir = tempfile::tempdir().expect("tempdir");
    let p: PathBuf = dir.path().join("a/b/c");
    assert!(!p.exists());
    ensure_central_repo(&p).unwrap();
    assert!(p.exists());
}
