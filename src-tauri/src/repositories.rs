use serde_json::{json, Value};
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

fn folder_metadata(path: &Path) -> Result<Value, String> {
    if !path.is_absolute() || !path.is_dir() {
        return Err("Select an existing repository folder.".into());
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or("Select a named folder, not a drive root.")?;
    let path = path
        .to_str()
        .ok_or("This folder path cannot be represented as text.")?;
    Ok(json!({"name": name, "path": path}))
}

#[tauri::command]
pub async fn select_repository_folder(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Select repository folder")
            .blocking_pick_folder();
        selected
            .map(|folder| {
                let path = folder
                    .into_path()
                    .map_err(|_| "Select a local folder.".to_string())?;
                folder_metadata(&path)
            })
            .transpose()
    })
    .await
    .map_err(|_| "Could not open the folder picker.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uses_selected_folder_name_without_reading_its_contents() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("Checkout service");
        std::fs::create_dir(&path).unwrap();
        let result = folder_metadata(&path).unwrap();
        assert_eq!(result["name"], "Checkout service");
        assert_eq!(result["path"], path.to_str().unwrap());
    }
    #[test]
    fn rejects_files_missing_folders_and_relative_paths() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("file.txt");
        std::fs::write(&file, "not a folder").unwrap();
        assert!(folder_metadata(&file).is_err());
        assert!(folder_metadata(&root.path().join("missing")).is_err());
        assert!(folder_metadata(Path::new("relative")).is_err());
    }
}
