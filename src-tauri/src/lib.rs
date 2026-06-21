mod commands;
mod db;
mod metadata;
mod scanner;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::image::Image;
use tauri::tray::TrayIconBuilder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Determine DB path: same directory as the executable, or app data dir
    let db_path = dirs_next().unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("mochi.db")
            .to_string_lossy()
            .to_string()
    });

    let conn = db::init_db(&db_path).expect("Failed to initialize database");

    let app_state = AppState {
        db: Mutex::new(conn),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_libmpv::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
                window.set_focus().ok();
            }
        }))
        .manage(app_state)
        .setup(|app| {
            // ── System tray ────────────────────────────────────────────────
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&quit_item)
                .build()?;

            // Generate a 32×32 icon with the letter "M" in #c47e3a on transparent background
            let icon_image = generate_tray_icon();
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap_or(icon_image))
                .menu(&menu)
                .tooltip("Mochi")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // ── Intercept close → hide to tray ────────────────────────────
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window_clone.hide().ok();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_library,
            commands::get_all_series,
            commands::get_series_by_id,
            commands::get_episodes_by_series,
            commands::get_episode_by_id,
            commands::get_resume_episode,
            commands::get_series_resume_episode,
            commands::update_watch_progress,
            commands::get_episode_path,
            commands::fetch_metadata,
            commands::match_bangumi_id,
            commands::match_tmdb_id,
            commands::search_bangumi,
            commands::search_tmdb_tv,
            commands::search_tmdb_movie,
            commands::update_search_term,
            commands::get_cache_dir,
            commands::read_image_base64,
            commands::set_fullscreen,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Get the database directory path (platform-appropriate).
/// Uses %APPDATA%/mochi on Windows.
fn dirs_next() -> Option<String> {
    let appdata = std::env::var("APPDATA").ok()?;
    let db_dir = std::path::Path::new(&appdata).join("mochi");
    std::fs::create_dir_all(&db_dir).ok()?;
    Some(db_dir.join("mochi.db").to_string_lossy().to_string())
}

/// Generate a 32×32 RGBA tray icon with the letter "M" in #c47e3a on a transparent background.
fn generate_tray_icon() -> Image<'static> {
    const SIZE: usize = 32;
    const R: u8 = 0xc4;
    const G: u8 = 0x7e;
    const B: u8 = 0x3a;

    // 8×8 bitmap for the letter "M" (1 = pixel on, 0 = pixel off)
    const M_BITMAP: [[u8; 8]; 8] = [
        [1, 0, 0, 0, 0, 0, 0, 1],
        [1, 1, 0, 0, 0, 0, 1, 1],
        [1, 1, 1, 0, 0, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 0, 1, 1, 0, 1, 1],
        [1, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 1],
    ];

    // Scale factor: 8px bitmap → 32px icon (×4)
    const SCALE: usize = SIZE / 8;
    let mut rgba = vec![0u8; SIZE * SIZE * 4];

    for by in 0..8usize {
        for bx in 0..8usize {
            if M_BITMAP[by][bx] == 1 {
                for dy in 0..SCALE {
                    for dx in 0..SCALE {
                        let px = bx * SCALE + dx;
                        let py = by * SCALE + dy;
                        let idx = (py * SIZE + px) * 4;
                        rgba[idx]     = R;
                        rgba[idx + 1] = G;
                        rgba[idx + 2] = B;
                        rgba[idx + 3] = 255;
                    }
                }
            }
        }
    }

    Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}
