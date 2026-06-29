use crate::db::{self, Episode, Person, Series};
use crate::metadata::{self, MetadataResult};
use crate::scanner::{self, ScanResult};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::State;
use tauri::Emitter;

/// Result of rescanning a single series folder.
#[derive(Debug, Clone, Serialize)]
pub struct RescanResult {
    pub episodes_found: usize,
    pub episodes_new: usize,
    pub episodes_deleted: usize,
}

/// Application state holding the database connection and runtime config.
pub struct AppState {
    pub db: Mutex<Connection>,
    pub close_behavior: Mutex<String>,
}

/// Cancellation flag for batch metadata fetch.
static BATCH_CANCEL: OnceLock<AtomicBool> = OnceLock::new();

/// Shared batch progress: (current, total).
static BATCH_PROGRESS: OnceLock<Mutex<Option<(usize, usize)>>> = OnceLock::new();

/// Return the path to the batch running state file.
fn batch_state_path() -> Result<std::path::PathBuf, String> {
    crate::paths::data_root().map(|p| p.join("mochi_batch_running"))
}

/// Persist a MetadataResult to the DB for a given series.
/// Caller must hold the DB lock.
fn persist_metadata_result(
    conn: &Connection,
    series_id: i64,
    result: &MetadataResult,
) -> Result<(), String> {
    db::update_series_metadata(
        conn,
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
    .map_err(|e| e.to_string())
}

/// Core metadata fetch for a single series: ID fast-path → search → TMDB backdrop enrichment.
/// Shared between single-series and batch fetch.
async fn fetch_series_metadata(
    search_term: &str,
    series_type: &str,
    bangumi_id: Option<i64>,
    tmdb_id: Option<i64>,
    tmdb_api_key: Option<&str>,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<MetadataResult, String> {
    let mut result = if let Some(bid) = bangumi_id.and_then(|id| if id > 0 { Some(id) } else { None }) {
        metadata::fetch_by_bangumi_id(bid as i32, proxy_url, force).await?
    } else if series_type != "anime" {
        if let Some(tid) = tmdb_id.and_then(|id| if id > 0 { Some(id) } else { None }) {
            let media_type = if series_type == "movie" { "movie" } else { "tv" };
            let key = tmdb_api_key.ok_or("TMDB API key required for ID fetch")?;
            metadata::fetch_by_tmdb_id(tid, media_type, key, "zh-CN", proxy_url, force).await?
        } else {
            metadata::fetch_metadata(search_term, series_type, tmdb_api_key, proxy_url, force).await?
        }
    } else {
        metadata::fetch_metadata(search_term, series_type, tmdb_api_key, proxy_url, force).await?
    };

    // TMDB backdrop enrichment for anime that lack fanart
    if result.fanart_path.is_none() && series_type == "anime" && tmdb_api_key.is_some() {
        if let Ok(fanart) =
            metadata::try_tmdb_backdrop(search_term, tmdb_api_key.unwrap(), proxy_url, force).await
        {
            result.fanart_path = Some(fanart);
        }
    }

    Ok(result)
}

// ── Scan command ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn scan_library(state: State<AppState>, root_path: String, root_type: Option<String>) -> Result<ScanResult, String> {
    let result = scanner::scan_library(&root_path, root_type.as_deref())?;

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

        // Try NFO import — only fills fields that are still NULL
        if !series_scan.folder_path.is_empty() {
            let dir = std::path::Path::new(&series_scan.folder_path);
            if let Some(nfo) = crate::nfo::read_nfo(dir) {
                db::apply_nfo_series_metadata(
                    &conn,
                    &series_scan.folder_name,
                    nfo.synopsis.as_deref(),
                    nfo.year,
                    nfo.genres.as_deref(),
                ).ok();
            }
        }

        for ep_scan in &series_scan.episodes {
            let subtitle_paths_json = if ep_scan.subtitle_paths.is_empty() {
                None
            } else {
                Some(serde_json::to_string(&ep_scan.subtitle_paths).unwrap_or_default())
            };
            let episode = Episode {
                id: 0,
                series_id,
                season_number: ep_scan.season_number,
                episode_number: ep_scan.episode_number,
                title: ep_scan.title.clone(),
                file_path: ep_scan.file_path.clone(),
                duration: 0,
                subtitle_count: ep_scan.subtitle_count,
                subtitle_paths: subtitle_paths_json,
                status: ep_scan.status.clone(),
                watched_progress: 0,
                watched_completed: 0,
                still_path: None,
                still_url: None,
                overview: None,
                air_date: None,
                runtime: None,
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

/// Remove all series under a given root path from the database.
/// Called when user removes a media library directory from settings.
#[tauri::command]
pub fn remove_root_dir(state: State<AppState>, root_path: String) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_series_by_root_path(&conn, &root_path).map_err(|e| e.to_string())
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

    // ── Fetch metadata (ID fast-path when no manual override) ──────────
    let mut result = if search_term_override.is_none() {
        fetch_series_metadata(
            &effective_term,
            &effective_type,
            bangumi_id,
            tmdb_id,
            tmdb_api_key.as_deref(),
            proxy_url.as_deref(),
            force,
        )
        .await?
    } else {
        // Manual override: always search, skip ID fast-path
        metadata::fetch_metadata(&effective_term, &effective_type, tmdb_api_key.as_deref(), proxy_url.as_deref(), force).await?
    };

    // Trust filesystem type only when it has a known type.
    // If filesystem type is "unknown", let the API result stand — this allows
    // metadata refresh to fix series that weren't pre-organized correctly.
    if effective_type != "unknown" {
        result.series_type = effective_type.clone();
    }

    // Persist to DB
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        persist_metadata_result(&conn, series_id, &result)?;
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
        persist_metadata_result(&conn, series_id, &result)?;
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
        persist_metadata_result(&conn, series_id, &result)?;
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

// ── Data stats ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_data_stats(state: State<AppState>) -> Result<db::DataStats, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_data_stats(&conn).map_err(|e| e.to_string())
}

// ── Reset metadata ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn reset_metadata(state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::reset_metadata(&conn).map_err(|e| e.to_string())?;
    Ok("已重置所有元数据".to_string())
}

// ── Clear watch progress ────────────────────────────────────────────────────

#[tauri::command]
pub fn clear_watch_progress(state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::clear_watch_progress(&conn).map_err(|e| e.to_string())?;
    Ok("已清除所有观看记录".to_string())
}

// ── Factory reset ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn factory_reset(state: State<AppState>) -> Result<String, String> {
    // 1. Clear database
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::factory_reset_db(&conn).map_err(|e| e.to_string())?;
    }
    // 2. Clear image cache
    let _ = clear_cache();
    Ok("done".to_string())
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
        persist_metadata_result(&conn, series_id, &result)?;
    } else if let (Some(tid), Some(mt), Some(key)) = (tmdb_id, media_type, tmdb_api_key) {
        let result = metadata::fetch_by_tmdb_id(tid, &mt, &key, "zh-CN", proxy_url.as_deref(), false).await?;
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        persist_metadata_result(&conn, series_id, &result)?;
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

/// Get the main window fullscreen state.
#[tauri::command]
pub fn get_fullscreen(window: tauri::Window) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
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

// ── Phase 3: Cast & Episode Metadata ───────────────────────────────────────

/// Fetch episode metadata (titles, stills, overviews) from TMDB for a series.
/// Anime series without a tmdb_id will trigger a TMDB TV search first.
#[tauri::command]
pub async fn fetch_episode_metadata(
    state: State<'_, AppState>,
    series_id: i64,
    tmdb_api_key: Option<String>,
    force: Option<bool>,
) -> Result<usize, String> {
    let proxy_url = std::env::var("MOCHI_PROXY_URL").ok();
    let key = tmdb_api_key.unwrap_or_default();

    if key.is_empty() {
        return Err("TMDB API key not configured".to_string());
    }

    crate::metadata::fetch_episode_metadata(&state.db, series_id, &key, proxy_url.as_deref(), force.unwrap_or(false)).await
}

/// Fetch cast (actors/characters) for a series.
/// Routes: anime → Bangumi characters, tv/movie → TMDB credits.
#[tauri::command]
pub async fn fetch_cast(
    state: State<'_, AppState>,
    series_id: i64,
    tmdb_api_key: Option<String>,
) -> Result<usize, String> {
    let proxy_url = std::env::var("MOCHI_PROXY_URL").ok();

    crate::metadata::fetch_cast(&state.db, series_id, tmdb_api_key.as_deref(), proxy_url.as_deref()).await
}

/// Get the stored cast list for a series.
/// Returns Vec<(Person, sort_order)>.
#[tauri::command]
pub fn get_series_cast(
    state: State<AppState>,
    series_id: i64,
) -> Result<Vec<(Person, i32)>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_series_cast(&conn, series_id).map_err(|e| e.to_string())
}

// ── Single-series refresh (mirrors batch per-series logic) ───────────────────

/// Refresh metadata for a single series, using the same code path as batch fetch.
/// Unlike `fetch_metadata`, this bypasses the command-level wrappers and calls
/// `fetch_cast` / `fetch_episode_metadata` with explicit proxy support.
#[tauri::command]
pub async fn refresh_single_series(
    state: State<'_, AppState>,
    series_id: i64,
    tmdb_api_key: Option<String>,
    proxy_url: Option<String>,
    search_term_override: Option<String>,
) -> Result<(), String> {
    let key = tmdb_api_key.as_deref();
    let proxy = proxy_url.as_deref();

    // Phase 1: Read series from DB
    let series = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_series_by_id(&conn, series_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Series not found: {series_id}"))?
    };

    // Phase 2: Fetch series metadata
    let effective_term = search_term_override
        .as_ref()
        .filter(|t| !t.trim().is_empty())
        .cloned()
        .unwrap_or(series.search_term.clone());

    let result = if search_term_override.is_some() {
        // Manual override: always search, skip ID fast-path
        metadata::fetch_metadata(&effective_term, &series.series_type, key, proxy, true).await?
    } else {
        fetch_series_metadata(
            &effective_term,
            &series.series_type,
            series.bangumi_id,
            series.tmdb_id,
            key,
            proxy,
            true,
        )
        .await?
    };

    // Phase 3: Persist
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        persist_metadata_result(&conn, series_id, &result)
            .map_err(|e| format!("Failed to persist metadata: {e}"))?;
        if search_term_override.is_some() {
            db::update_series_search_term(&conn, series_id, &effective_term)
                .map_err(|e| e.to_string())?;
        }
    }

    // Phase 4: Cast + episode metadata (same as batch — direct module calls, quiet errors)
    if let Some(k) = key {
        crate::metadata::fetch_cast(&state.db, series_id, Some(k), proxy).await.ok();
        crate::metadata::fetch_episode_metadata(&state.db, series_id, k, proxy, true).await.ok();
    }

    Ok(())
}

// ── Single-series rescan ─────────────────────────────────────────────────────

/// Rescan a single series folder for new/removed episode files.
/// Useful for ongoing series where new episodes are added to an existing folder.
#[tauri::command]
pub fn rescan_series_folder(
    state: State<AppState>,
    series_id: i64,
    root_paths: Vec<String>,
) -> Result<RescanResult, String> {
    // Phase 1: Read series from DB
    let series = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_series_by_id(&conn, series_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Series not found: {series_id}"))?
    };

    let folder_name = &series.folder_name;

    // Phase 2: Find the folder on disk
    // Try all known type-hint directories + flat layout
    let mut found_path: Option<std::path::PathBuf> = None;
    let all_type_dirs = ["anime", "tv", "movie", "variety"];

    for root in &root_paths {
        let root_path = std::path::Path::new(root);
        // Try hierarchical: root / {anime,tv,movie,variety} / folder_name
        for type_dir in &all_type_dirs {
            let candidate = root_path.join(type_dir).join(folder_name);
            if candidate.is_dir() {
                found_path = Some(candidate);
                break;
            }
        }
        if found_path.is_some() {
            break;
        }
        // Try flat: root / folder_name
        let candidate = root_path.join(folder_name);
        if candidate.is_dir() {
            found_path = Some(candidate);
            break;
        }
    }

    let dir_path = found_path.ok_or_else(|| {
        format!("Series folder not found on disk: {folder_name}")
    })?;

    // Phase 3: Extract season from folder name and scan
    let (_, folder_season) = scanner::extract_season_from_name(folder_name);
    let (episodes, _poster, _fanart) =
        scanner::scan_series_folder(&dir_path, folder_season)?;

    // Phase 4: Upsert episodes to DB
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let before_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM episodes WHERE series_id = ?1",
            params![series_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    eprintln!("rescan series {series_id}: scanned={} before={before_count}", episodes.len());

    for ep_scan in &episodes {
        let subtitle_paths_json = if ep_scan.subtitle_paths.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&ep_scan.subtitle_paths).unwrap_or_default())
        };
        let episode = Episode {
            id: 0,
            series_id,
            season_number: ep_scan.season_number,
            episode_number: ep_scan.episode_number,
            title: ep_scan.title.clone(),
            file_path: ep_scan.file_path.clone(),
            duration: 0,
            subtitle_count: ep_scan.subtitle_count,
            subtitle_paths: subtitle_paths_json,
            status: ep_scan.status.clone(),
            watched_progress: 0,
            watched_completed: 0,
            still_path: None,
            still_url: None,
            overview: None,
            air_date: None,
            runtime: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        db::upsert_episode(&conn, &episode).map_err(|e| e.to_string())?;
    }

    // Try NFO import — only fills fields that are still NULL
    if let Some(nfo) = crate::nfo::read_nfo(&dir_path) {
        db::apply_nfo_series_metadata(
            &conn,
            folder_name,
            nfo.synopsis.as_deref(),
            nfo.year,
            nfo.genres.as_deref(),
        ).ok();
    }

    // Phase 5: Clean up episodes that no longer exist on disk (for this series only)
    let deleted = db::delete_missing_episodes_for_series(&conn, series_id).map_err(|e| e.to_string())?;
    eprintln!("rescan series {series_id}: deleted={deleted}", );

    let after_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM episodes WHERE series_id = ?1",
            params![series_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let new_count = (after_count - before_count).max(0) as usize;
    Ok(RescanResult {
        episodes_found: episodes.len(),
        episodes_new: new_count,
        episodes_deleted: deleted,
    })
}

// ── Onboarding ───────────────────────────────────────────────────────────────

/// Create the recommended library folder structure at the given path.
/// Creates anime/, movie/, tv/, variety/ subdirectories.
#[tauri::command]
pub fn create_library_structure(base_path: String) -> Result<(), String> {
    let base = std::path::Path::new(&base_path);
    if !base.is_dir() {
        return Err(format!("path not found: {base_path}"));
    }
    for sub in &["anime", "movie", "tv", "variety"] {
        let sub_path = base.join(sub);
        std::fs::create_dir_all(&sub_path)
            .map_err(|e| format!("create {sub} failed: {e}"))?;
    }
    Ok(())
}

// ── Batch metadata fetch ────────────────────────────────────────────────────

/// Batch fetch metadata for all series.
/// Runs as a background task in Rust, emits progress events to the frontend.
#[tauri::command]
pub async fn batch_fetch_all_metadata(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    tmdb_api_key: Option<String>,
    proxy_url: Option<String>,
) -> Result<(), String> {
    // Initialize cancellation flag
    let cancel = BATCH_CANCEL.get_or_init(|| AtomicBool::new(false));
    if cancel.load(Ordering::SeqCst) {
        return Err("Batch fetch already running".to_string());
    }
    cancel.store(false, Ordering::SeqCst);

    // Initialize progress tracker
    let progress = BATCH_PROGRESS.get_or_init(|| Mutex::new(None));

    // Write state file for cross-session cleanup
    if let Ok(state_path) = batch_state_path() {
        std::fs::write(&state_path, "1").ok();
    }

    // Get all series from DB
    let all = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_all_series(&conn).map_err(|e| e.to_string())?
    };

    let total = all.len();
    app.emit("batch-fetch-start", total).ok();

    for (i, series) in all.iter().enumerate() {
        // Check cancellation
        if cancel.load(Ordering::SeqCst) {
            app.emit("batch-fetch-cancelled", ()).ok();
            break;
        }

        app.emit("batch-fetch-progress", serde_json::json!({
            "current": i + 1,
            "total": total,
            "seriesName": series.display_name,
        })).ok();

        // Update shared progress for cross-component status query
        if let Ok(mut p) = progress.lock() {
            *p = Some((i + 1, total));
        }

        // Fetch metadata
        let key = tmdb_api_key.as_deref();
        let proxy = proxy_url.as_deref();
        match fetch_series_metadata(
            &series.search_term,
            &series.series_type,
            series.bangumi_id,
            series.tmdb_id,
            key,
            proxy,
            true,
        )
        .await
        {
            Ok(result) => {
                let conn = state.db.lock().map_err(|e| e.to_string())?;
                persist_metadata_result(&conn, series.id, &result).ok();
            }
            Err(_) => { /* skip failed series */ }
        }

        // Fetch cast (quiet)
        if let Some(k) = key {
            crate::metadata::fetch_cast(&state.db, series.id, Some(k), proxy).await.ok();
        }

        // Fetch episode metadata (quiet)
        if let Some(k) = key {
            crate::metadata::fetch_episode_metadata(&state.db, series.id, k, proxy, true).await.ok();
        }

        // Rate limit: 250ms between series (TMDB free tier: ~40 req/s)
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    // Cleanup
    if let Ok(state_path) = batch_state_path() {
        std::fs::remove_file(&state_path).ok();
    }
    cancel.store(false, Ordering::SeqCst);
    if let Ok(mut p) = progress.lock() {
        *p = None;
    }
    app.emit("batch-fetch-complete", ()).ok();

    Ok(())
}

/// Cancel a running batch metadata fetch.
#[tauri::command]
pub fn cancel_batch_fetch() -> Result<(), String> {
    if let Some(cancel) = BATCH_CANCEL.get() {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Query whether a batch fetch is running and its progress.
/// Returns None if no batch is active, or Some((current, total)).
#[tauri::command]
pub fn get_batch_status() -> Result<Option<(usize, usize)>, String> {
    let progress = BATCH_PROGRESS
        .get()
        .and_then(|p| p.lock().ok())
        .and_then(|p| *p);
    Ok(progress)
}
