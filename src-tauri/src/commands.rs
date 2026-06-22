use crate::db::{self, Episode, Series};
use crate::metadata::{self, MetadataResult};
use crate::scanner::{self, ScanResult};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

/// Application state holding the database connection and runtime config.
pub struct AppState {
    pub db: Mutex<Connection>,
    pub close_behavior: Mutex<String>,
}

// ── Scan command ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn scan_library(state: State<AppState>, root_path: String) -> Result<ScanResult, String> {
    let result = scanner::scan_library(&root_path)?;

    // Persist scan results to DB
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    for series_scan in &result.series {
        let series = Series {
            id: 0, // will be assigned by DB
            title: series_scan.display_name.clone(),
            folder_name: series_scan.folder_name.clone(),
            display_name: series_scan.display_name.clone(),
            search_term: series_scan.search_term.clone(),
            series_type: series_scan.series_type_hint.clone().unwrap_or_else(|| "unknown".to_string()),
            poster_path: series_scan.poster_path.clone(),
            fanart_path: series_scan.fanart_path.clone(),
            bangumi_id: None,
            tmdb_id: None,
            synopsis: None,
            year: None,
            genres: None,
            score: None,
            created_at: String::new(),
            updated_at: String::new(),
        };

        let series_id = db::upsert_series(&conn, &series).map_err(|e| e.to_string())?;

        for ep_scan in &series_scan.episodes {
            let episode = Episode {
                id: 0,
                series_id,
                season_number: ep_scan.season_number,
                episode_number: ep_scan.episode_number,
                title: ep_scan.title.clone(),
                file_path: ep_scan.file_path.clone(),
                duration: 0,
                subtitle_count: ep_scan.subtitle_count,
                status: ep_scan.status.clone(),
                watched_progress: 0,
                watched_completed: 0,
                created_at: String::new(),
                updated_at: String::new(),
            };

            db::upsert_episode(&conn, &episode).map_err(|e| e.to_string())?;
        }
    }

    // Clean up episodes that no longer exist on disk
    db::delete_missing_episodes(&conn).map_err(|e| e.to_string())?;

    Ok(result)
}

// ── Series queries ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_all_series(state: State<AppState>) -> Result<Vec<Series>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_all_series(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_series_by_id(state: State<AppState>, id: i64) -> Result<Option<Series>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_series_by_id(&conn, id).map_err(|e| e.to_string())
}

// ── Episode queries ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_episodes_by_series(
    state: State<AppState>,
    series_id: i64,
) -> Result<Vec<Episode>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_episodes_by_series(&conn, series_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_episode_by_id(state: State<AppState>, id: i64) -> Result<Option<Episode>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_episode_by_id(&conn, id).map_err(|e| e.to_string())
}

// ── Playback ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_resume_episode(state: State<AppState>) -> Result<Option<Episode>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_resume_episode(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_series_resume_episode(state: State<AppState>, series_id: i64) -> Result<Option<Episode>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_series_resume_episode(&conn, series_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_watch_progress(
    state: State<AppState>,
    episode_id: i64,
    progress_secs: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_watch_progress(&conn, episode_id, progress_secs).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_episode_path(
    state: State<AppState>,
    episode_id: i64,
) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_episode_path(&conn, episode_id).map_err(|e| e.to_string())
}

// ── Phase 2: Metadata ────────────────────────────────────────────────────────

/// Auto dual-search with ID fast-path.
/// If the series already has a bangumi_id or tmdb_id, skip search and fetch directly.
/// Otherwise search by term + type. If `search_term_override` is provided,
/// skip the ID fast-path and use the override term instead of the stored one.
/// If `root_paths` is provided, re-derive the type from filesystem (fixes stale DB type).
/// Updates the DB with any fetched metadata.
#[tauri::command]
pub async fn fetch_metadata(
    state: State<'_, AppState>,
    series_id: i64,
    tmdb_api_key: Option<String>,
    proxy_url: Option<String>,
    force: bool,
    search_term_override: Option<String>,
    root_paths: Option<Vec<String>>,
) -> Result<MetadataResult, String> {
    // Extract metadata from DB (don't hold DB lock across await)
    let (search_term, series_type, bangumi_id, tmdb_id, folder_name) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let series = db::get_series_by_id(&conn, series_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Series not found: {series_id}"))?;
        (
            series.search_term.clone(),
            series.series_type.clone(),
            series.bangumi_id,
            series.tmdb_id,
            series.folder_name.clone(),
        )
    };

    // Re-derive the true type from filesystem if root_paths is available.
    // DB type may be stale (e.g. polluted by a previous TMDB fallback).
    let effective_type = if let Some(ref paths) = root_paths {
        crate::scanner::resolve_type_from_filesystem(paths, &folder_name)
            .unwrap_or(series_type)
    } else {
        series_type
    };

    // Use the effective search term
    let effective_term = search_term_override
        .as_ref()
        .filter(|t| !t.trim().is_empty())
        .cloned()
        .unwrap_or(search_term);

    // ── ID fast-path: skip search if we already have an ID ────────────
    // Only use fast-path when no manual override is given (user wants a fresh search)
    // For anime, ignore tmdb_id (likely pollution from a previous fallback).
    let mut result = if search_term_override.is_none() {
        if let Some(bid) = bangumi_id.and_then(|id| if id > 0 { Some(id) } else { None }) {
            metadata::fetch_by_bangumi_id(bid as i32, proxy_url.as_deref(), force).await?
        } else if effective_type != "anime" {
            if let Some(tid) = tmdb_id.and_then(|id| if id > 0 { Some(id) } else { None }) {
                let media_type = if effective_type == "movie" { "movie" } else { "tv" };
                let key = tmdb_api_key.as_deref().ok_or("TMDB API key required for ID fetch")?;
                metadata::fetch_by_tmdb_id(tid, media_type, key, "zh-CN", proxy_url.as_deref(), force).await?
            } else {
                metadata::fetch_metadata(&effective_term, &effective_type, tmdb_api_key.as_deref(), proxy_url.as_deref(), force).await?
            }
        } else {
            metadata::fetch_metadata(&effective_term, &effective_type, tmdb_api_key.as_deref(), proxy_url.as_deref(), force).await?
        }
    } else {
        // Manual override: always search, skip ID fast-path
        metadata::fetch_metadata(&effective_term, &effective_type, tmdb_api_key.as_deref(), proxy_url.as_deref(), force).await?
    };

    // Always trust filesystem type over API metadata for the type field.
    // API metadata may be wrong (e.g. TMDB fallback pollution).
    result.series_type = effective_type.clone();

    // ── TMDB backdrop enrichment for anime ────────────────────────────
    // Bangumi doesn't provide banners/backdrops. When we already have a
    // bangumi_id (ID fast-path above), the TMDB backdrop search is skipped.
    // Do it here as a post-fetch step for all anime results that lack fanart.
    if result.fanart_path.is_none()
        && effective_type == "anime"
        && tmdb_api_key.is_some()
    {
        if let Ok(fanart) = crate::metadata::try_tmdb_backdrop(
            &effective_term,
            tmdb_api_key.as_deref().unwrap(),
            proxy_url.as_deref(),
            force,
        )
        .await
        {
            result.fanart_path = Some(fanart);
        }
    }

    // Persist to DB
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::update_series_metadata(
            &conn,
            series_id,
            &result.title,
            &result.series_type,
            result.bangumi_id,
            result.tmdb_id,
            result.synopsis.as_deref(),
            result.year,
            result.genres.as_deref(),
            result.poster_path.as_deref(),
            result.fanart_path.as_deref(),
            result.score,
        )
        .map_err(|e| e.to_string())?;
        // Update search_term in DB if a manual override was used and it found something
        if search_term_override.is_some() {
            db::update_series_search_term(&conn, series_id, &effective_term)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(result)
}

/// Manually match a series to a known Bangumi ID.
#[tauri::command]
pub async fn match_bangumi_id(
    state: State<'_, AppState>,
    series_id: i64,
    bangumi_id: i32,
    proxy_url: Option<String>,
    force: bool,
) -> Result<MetadataResult, String> {
    let result = metadata::fetch_by_bangumi_id(bangumi_id, proxy_url.as_deref(), force).await?;

    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::update_series_metadata(
            &conn,
            series_id,
            &result.title,
            &result.series_type,
            result.bangumi_id,
            result.tmdb_id,
            result.synopsis.as_deref(),
            result.year,
            result.genres.as_deref(),
            result.poster_path.as_deref(),
            result.fanart_path.as_deref(),
            result.score,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(result)
}

/// Manually match a series to a known TMDB ID.
#[tauri::command]
pub async fn match_tmdb_id(
    state: State<'_, AppState>,
    series_id: i64,
    tmdb_id: i64,
    media_type: String,
    tmdb_api_key: String,
    proxy_url: Option<String>,
    force: bool,
) -> Result<MetadataResult, String> {
    let result =
        metadata::fetch_by_tmdb_id(tmdb_id, &media_type, &tmdb_api_key, "zh-CN", proxy_url.as_deref(), force).await?;

    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::update_series_metadata(
            &conn,
            series_id,
            &result.title,
            &result.series_type,
            result.bangumi_id,
            result.tmdb_id,
            result.synopsis.as_deref(),
            result.year,
            result.genres.as_deref(),
            result.poster_path.as_deref(),
            result.fanart_path.as_deref(),
            result.score,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(result)
}

/// Search Bangumi for manual matching (doesn't update DB).
#[tauri::command]
pub async fn search_bangumi(query: String, proxy_url: Option<String>) -> Result<Vec<metadata::BangumiSearchResult>, String> {
    let client = metadata::BangumiClient::with_proxy(proxy_url.as_deref());
    client.search(&query).await
}

/// Search TMDB TV shows for manual matching (doesn't update DB).
#[tauri::command]
pub async fn search_tmdb_tv(
    query: String,
    tmdb_api_key: String,
    proxy_url: Option<String>,
    language: Option<String>,
    page: Option<u32>,
) -> Result<Vec<metadata::TmdbSearchResult>, String> {
    let client = metadata::TmdbClient::new(&tmdb_api_key, proxy_url.as_deref());
    client
        .search_tv(&query, language.as_deref().unwrap_or("zh-CN"), page.unwrap_or(1))
        .await
}

/// Search TMDB movies for manual matching (doesn't update DB).
#[tauri::command]
pub async fn search_tmdb_movie(
    query: String,
    tmdb_api_key: String,
    proxy_url: Option<String>,
    language: Option<String>,
    page: Option<u32>,
) -> Result<Vec<metadata::TmdbSearchResult>, String> {
    let client = metadata::TmdbClient::new(&tmdb_api_key, proxy_url.as_deref());
    client
        .search_movie(&query, language.as_deref().unwrap_or("zh-CN"), page.unwrap_or(1))
        .await
}

/// Update a series' search term (for manual correction after failed auto-match).
#[tauri::command]
pub fn update_search_term(
    state: State<AppState>,
    series_id: i64,
    new_term: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_series_search_term(&conn, series_id, &new_term).map_err(|e| e.to_string())
}

/// Update the series type from the detail page dropdown.
#[tauri::command]
pub fn update_series_type(
    state: State<AppState>,
    series_id: i64,
    new_type: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_series_type(&conn, series_id, &new_type).map_err(|e| e.to_string())
}

/// Return the image cache directory path (for frontend asset URL conversion).
#[tauri::command]
pub fn get_cache_dir() -> Result<String, String> {
    metadata::cache_dir().map(|p| p.to_string_lossy().to_string())
}

/// Return the total size of all cached images in bytes.
#[tauri::command]
pub fn get_cache_size() -> Result<u64, String> {
    let dir = metadata::cache_dir()?;
    let mut total = 0u64;
    if dir.exists() {
        for entry in walkdir::WalkDir::new(&dir).min_depth(1) {
            if let Ok(entry) = entry {
                if entry.file_type().is_file() {
                    total += entry.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
    }
    Ok(total)
}

/// Delete all cached images and return how many bytes were freed.
#[tauri::command]
pub fn clear_cache() -> Result<u64, String> {
    let dir = metadata::cache_dir()?;
    let mut total = 0u64;
    if dir.exists() {
        for entry in walkdir::WalkDir::new(&dir).min_depth(1) {
            if let Ok(entry) = entry {
                if entry.file_type().is_file() {
                    total += entry.metadata().map(|m| m.len()).unwrap_or(0);
                    std::fs::remove_file(entry.path()).ok();
                }
            }
        }
    }
    Ok(total)
}

/// Find a series by its folder_name (used during verdict flow to get series_id).
#[tauri::command]
pub fn get_series_by_folder(
    state: State<AppState>,
    folder_name: String,
) -> Result<Option<Series>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_series_by_folder(&conn, &folder_name).map_err(|e| e.to_string())
}

/// Save verdict: write .mochi file and update DB metadata.
/// Called after user selects a match in the verdict modal.
#[tauri::command]
pub async fn save_verdict(
    state: State<'_, AppState>,
    folder_path: String,
    folder_name: String,
    new_type: String,
    bangumi_id: Option<i32>,
    tmdb_id: Option<i64>,
    media_type: Option<String>,
    tmdb_api_key: Option<String>,
    proxy_url: Option<String>,
) -> Result<(), String> {
    // 1. Find the series in DB
    let series_id = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let series = db::get_series_by_folder(&conn, &folder_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("未找到系列: {folder_name}"))?;
        series.id
    };

    // 2. Fetch metadata if an ID was provided
    if let Some(bid) = bangumi_id {
        let result = metadata::fetch_by_bangumi_id(bid, proxy_url.as_deref(), false).await?;
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::update_series_metadata(
            &conn, series_id,
            &result.title, &result.series_type,
            result.bangumi_id, result.tmdb_id,
            result.synopsis.as_deref(), result.year, result.genres.as_deref(),
            result.poster_path.as_deref(), result.fanart_path.as_deref(), result.score,
        ).map_err(|e| e.to_string())?;
    } else if let (Some(tid), Some(mt), Some(key)) = (tmdb_id, media_type, tmdb_api_key) {
        let result = metadata::fetch_by_tmdb_id(tid, &mt, &key, "zh-CN", proxy_url.as_deref(), false).await?;
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::update_series_metadata(
            &conn, series_id,
            &result.title, &result.series_type,
            result.bangumi_id, result.tmdb_id,
            result.synopsis.as_deref(), result.year, result.genres.as_deref(),
            result.poster_path.as_deref(), result.fanart_path.as_deref(), result.score,
        ).map_err(|e| e.to_string())?;
    } else {
        // No ID provided: just update the type
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::update_series_type(&conn, series_id, &new_type).map_err(|e| e.to_string())?;
    }

    // 3. Write .mochi file
    if !folder_path.is_empty() {
        let dir = std::path::Path::new(&folder_path);
        let mochi = crate::mochi_file::MochiFile {
            series_type: Some(new_type),
            tmdb_id,
            bangumi_id: bangumi_id.map(|id| id as i64),
            search_term: None,
            last_fetched: None,
        };
        crate::mochi_file::write_mochi(dir, &mochi)?;
    }

    Ok(())
}

/// Clear all .mochi verdict files and reset metadata IDs in DB.
/// Preserves series.type. Frontend calls this from Settings > "清除所有裁决数据".
#[tauri::command]
pub fn clear_all_verdicts(
    state: State<AppState>,
    root_paths: Vec<String>,
) -> Result<String, String> {
    use std::fs;
    let mut deleted_count = 0u32;

    // 1. Delete .mochi files from series folders and .mochi/ directories
    for root_path in &root_paths {
        let root = std::path::Path::new(root_path);
        let mochi_dir = root.join(".mochi");

        // Delete centralized .mochi/ directory
        if mochi_dir.is_dir() {
            fs::remove_dir_all(&mochi_dir)
                .map_err(|e| format!("删除 .mochi/ 目录失败: {e}"))?;
            deleted_count += 1;
        }

        // Walk series folders and delete per-folder .mochi
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let mochi_file = path.join(".mochi");
                    if mochi_file.is_file() {
                        fs::remove_file(&mochi_file)
                            .map_err(|e| format!("删除 {} 失败: {e}", mochi_file.display()))?;
                        deleted_count += 1;
                    }
                    // Also check subdirectories (type-hint containers)
                    if let Ok(sub_entries) = fs::read_dir(&path) {
                        for sub_entry in sub_entries.flatten() {
                            let sub_path = sub_entry.path();
                            if sub_path.is_dir() {
                                let sub_mochi = sub_path.join(".mochi");
                                if sub_mochi.is_file() {
                                    fs::remove_file(&sub_mochi)
                                        .map_err(|e| format!("删除 {} 失败: {e}", sub_mochi.display()))?;
                                    deleted_count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Reset metadata IDs in DB
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::clear_all_metadata_ids(&conn).map_err(|e| e.to_string())?;
    }

    Ok(format!("已清除 {deleted_count} 个裁决文件"))
}

/// Read an image file and return it as a base64 data URL.
/// Bypasses Tauri's asset protocol scope entirely.
#[tauri::command]
pub fn read_image_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("读取失败: {e}"))?;
    if bytes.is_empty() {
        return Err("文件为空".to_string());
    }
    // Detect MIME type from magic bytes
    let mime = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.starts_with(&[0x47, 0x49, 0x46]) {
        "image/gif"
    } else if bytes.starts_with(&[0x52, 0x49, 0x46, 0x46]) {
        "image/webp"
    } else {
        // Fallback: check extension
        let ext = std::path::Path::new(&path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/jpeg",
        }
    };
    let b64 = base64_encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

fn base64_encode(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 0x3F) as usize] as char);
        out.push(CHARS[((n >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((n >> 6) & 0x3F) as usize] as char);
        } else {
            out.push(CHARS[64] as char);
        }
        if chunk.len() > 2 {
            out.push(CHARS[(n & 0x3F) as usize] as char);
        } else {
            out.push(CHARS[64] as char);
        }
    }
    out
}

/// Return the app version string from tauri.conf.json.
#[tauri::command]
pub fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Get the current close behavior ("tray" or "exit").
#[tauri::command]
pub fn get_close_behavior(state: State<AppState>) -> Result<String, String> {
    state.close_behavior.lock().map(|b| b.clone()).map_err(|e| e.to_string())
}

/// Set the close behavior and persist to config.json.
#[tauri::command]
pub fn set_close_behavior(state: State<AppState>, behavior: String) -> Result<(), String> {
    // Validate
    if behavior != "tray" && behavior != "exit" {
        return Err(format!("Invalid close behavior: {behavior}"));
    }
    // Update runtime state
    {
        let mut b = state.close_behavior.lock().map_err(|e| e.to_string())?;
        *b = behavior.clone();
    }
    // Persist to disk
    let config = crate::Config {
        close_behavior: behavior,
    };
    crate::write_config(&config)
}

// ── Phase 2: Window control ─────────────────────────────────────────────────

/// Toggle the main window fullscreen state.
#[tauri::command]
pub fn set_fullscreen(window: tauri::Window, fullscreen: bool) {
    window.set_fullscreen(fullscreen).ok();
}

#[tauri::command]
pub fn window_minimize(window: tauri::Window) {
    window.minimize().ok();
}

#[tauri::command]
pub fn window_toggle_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().ok();
    } else {
        window.maximize().ok();
    }
}

#[tauri::command]
pub fn window_close(window: tauri::Window, state: State<AppState>) {
    let behavior = state.close_behavior.lock().unwrap().clone();
    if behavior == "exit" {
        // Use the OS syscall directly — Tauri's app.exit(0) is unreliable
        // when called from within a close event.
        std::process::exit(0);
    } else {
        window.hide().ok();
    }
}
