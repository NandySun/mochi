use crate::db::{self, Episode, Series};
use crate::metadata::{self, MetadataResult};
use crate::scanner::{self, ScanResult};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

/// Application state holding the database connection.
pub struct AppState {
    pub db: Mutex<Connection>,
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

/// Auto dual-search: AniList → TMDB fallback.
/// Updates the DB with any fetched metadata.
#[tauri::command]
pub async fn fetch_metadata(
    state: State<'_, AppState>,
    series_id: i64,
    tmdb_api_key: Option<String>,
    proxy_url: Option<String>,
    force: bool,
) -> Result<MetadataResult, String> {
    // Extract search term and type first (don't hold DB lock across await)
    let (search_term, series_type) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let series = db::get_series_by_id(&conn, series_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Series not found: {series_id}"))?;
        (series.search_term.clone(), series.series_type.clone())
    };

    // Fetch metadata from APIs (may take several seconds)
    let result =
        metadata::fetch_metadata(&search_term, &series_type, tmdb_api_key.as_deref(), proxy_url.as_deref(), force).await?;

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

/// Return the image cache directory path (for frontend asset URL conversion).
#[tauri::command]
pub fn get_cache_dir() -> Result<String, String> {
    metadata::cache_dir().map(|p| p.to_string_lossy().to_string())
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
pub fn window_close(window: tauri::Window) {
    window.hide().ok();
}
