use walkdir::WalkDir;

#[tauri::command]
fn search_local_files(query: String, ext: String) -> Vec<String> {
    let mut results = Vec::new();
    // Default to the user's Documents directory
    let home = dirs::document_dir().unwrap_or_default();
    
    // Fast walk over the directory
    for entry in WalkDir::new(home).into_iter().filter_map(|e| e.ok()) {
        let fname = entry.file_name().to_string_lossy().to_lowercase();
        let q = query.to_lowercase();
        
        if fname.contains(&q) {
            if ext.is_empty() || fname.ends_with(&ext.to_lowercase()) {
                results.push(entry.path().to_string_lossy().into_owned());
            }
        }
        
        // Cap results to prevent overwhelming the AI
        if results.len() >= 5 {
            break;
        }
    }
    
    results
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![search_local_files])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
