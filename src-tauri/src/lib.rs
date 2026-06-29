mod commands;
mod db;
mod metadata;
mod mochi_file;
mod nfo;
mod paths;
mod scanner;

use commands::AppState;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri::Emitter;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::image::Image;
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton};
use tauri_plugin_window_state::StateFlags;

/// App configuration persisted to %APPDATA%/mochi/config.json
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct Config {
    close_behavior: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            close_behavior: "tray".to_string(),
        }
    }
}

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

    // Read config (fallback to defaults if file missing or corrupt)
    let config = config_path()
        .ok()
        .and_then(|p| read_config(&p).ok())
        .unwrap_or_default();

    let app_state = AppState {
        db: Mutex::new(conn),
        close_behavior: Mutex::new(config.close_behavior),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_libmpv::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::VISIBLE | StateFlags::DECORATIONS).build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
                window.set_focus().ok();
            }
        }))
        .manage(app_state)
        .setup(|app| {
            // ── Startup cleanup: clear stale batch-fetch state ───────────
            if let Ok(root) = crate::paths::data_root() {
                let stale = root.join("mochi_batch_running");
                if stale.exists() {
                    std::fs::remove_file(&stale).ok();
                }
            }

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
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── Intercept close → hide to tray (configurable) ──────────
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let behavior = app_handle
                        .state::<AppState>()
                        .close_behavior
                        .lock()
                        .unwrap()
                        .clone();
                    if behavior == "tray" {
                        api.prevent_close();
                        window_clone.hide().ok();
                        let _ = window_clone.emit("tray-minimized", ());
                    } else {
                        // "exit" — Tauri's app.exit(0) is unreliable inside
                        // CloseRequested (event loop state prevents it from
                        // being consumed). Use the system call directly.
                        std::process::exit(0);
                    }
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
            commands::update_series_type,
            commands::get_series_by_folder,
            commands::save_verdict,
            commands::clear_all_verdicts,
            commands::get_cache_dir,
            commands::get_cache_size,
            commands::clear_cache,
            commands::read_image_base64,
            commands::get_series_cast,
            commands::fetch_cast,
            commands::fetch_episode_metadata,
            commands::refresh_single_series,
            commands::rescan_series_folder,
            commands::get_app_version,
            commands::get_close_behavior,
            commands::set_close_behavior,
            commands::set_fullscreen,
            commands::get_fullscreen,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::create_library_structure,
            commands::batch_fetch_all_metadata,
            commands::cancel_batch_fetch,
            commands::get_batch_status,
            commands::remove_root_dir,
            commands::get_data_stats,
            commands::reset_metadata,
            commands::clear_watch_progress,
            commands::factory_reset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Get the database path.
/// Delegates to paths::data_root() for portable/installed mode resolution.
fn dirs_next() -> Option<String> {
    let db_path = paths::data_root().ok()?.join("mochi.db");
    Some(db_path.to_string_lossy().to_string())
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

/// Path to config.json.
/// Delegates to paths::data_root() for portable/installed mode resolution.
fn config_path() -> Result<PathBuf, String> {
    Ok(paths::data_root()?.join("config.json"))
}

/// Read config.json, returning Default on any failure.
fn read_config(path: &PathBuf) -> Result<Config, String> {
    if !path.exists() {
        return Ok(Config::default());
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("read config: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse config: {e}"))
}

/// Write Config to config.json.
pub(crate) fn write_config(config: &Config) -> Result<(), String> {
    let path = config_path()?;
    let json = serde_json::to_string_pretty(config).map_err(|e| format!("serialize config: {e}"))?;
    fs::write(&path, &json).map_err(|e| format!("write config: {e}"))
}
