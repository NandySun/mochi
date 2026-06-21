//! Phase 2: External metadata fetching and image caching.
//!
//! ## Dual-search strategy (Phase 2)
//!
//! Routing is driven by folder structure, not language heuristics:
//!
//! ```text
//! series.type (from scanner)
//!   ├── "anime"  → Bangumi (free CN anime DB)
//!   │     ├── ✅ hit → enriched with CN metadata
//!   │     └── ❌ miss → TMDB (fallback)
//!   ├── "tv" / "movie" → TMDB (requires API key)
//!   │     ├── ✅ hit → enriched
//!   │     └── ❌ miss → Bangumi (fallback)
//!   └── "unknown" → try Bangumi then TMDB
//! ```
//!
//! Folder convention:
//! ```text
//! D:\Video\
//!   anime\          ← type hint → all series inside get type=anime
//!     黄泉使者_Yomi no Tsugai\
//!   tv\              ← type hint → all series inside get type=tv
//!     太阳星辰\
//!   movie\           ← type hint → all series inside get type=movie
//! ```
//!
//! Images are downloaded to `%APPDATA%/mochi/cache/` and paths stored in SQLite.
//! Existing cache files are reused; set `force=true` to re-download.

mod bangumi;
mod cache;
mod tmdb;

use serde::{Deserialize, Serialize};

pub use bangumi::{BangumiClient, BangumiSearchResult, BangumiSubjectDetail, BangumiTag};
pub use cache::{bangumi_cache_path, cache_dir, download_image, tmdb_cache_path};
pub use tmdb::{tmdb_image_url, TmdbClient, TmdbSearchResult};

// ── Unified result ────────────────────────────────────────────────────────────

/// Result of a metadata fetch operation, ready to write to the DB.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataResult {
    /// Display title (prefers Chinese name_cn from Bangumi).
    pub title: String,
    /// "anime", "tv", "movie", or "unknown".
    pub series_type: String,
    /// Bangumi subject ID (only for anime).
    pub bangumi_id: Option<i64>,
    /// TMDB show/movie ID (only for TV/movies).
    pub tmdb_id: Option<i64>,
    /// Plot summary.
    pub synopsis: Option<String>,
    /// Release year.
    pub year: Option<i32>,
    /// JSON array of genre strings, e.g. `["Action","Fantasy"]`.
    pub genres: Option<String>,
    /// Local cache path for the poster image.
    pub poster_path: Option<String>,
    /// Local cache path for the banner/backdrop image.
    pub fanart_path: Option<String>,
    /// Aggregated score 0–100 (Bangumi score 0-10 scaled ×10;
    /// TMDB vote_average 0-10 is scaled ×10 before storage).
    pub score: Option<i32>,
    /// Human-readable diagnostic message (e.g. image download status).
    pub diagnostic: Option<String>,
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/// Run the dual-search strategy for a series.
///
/// * `search_term` — the search keyword extracted from the folder name.
/// * `tmdb_api_key` — TMDB v3 API key; if `None`, TMDB is skipped.
/// * `force` — if true, re-download images even when cached.
pub async fn fetch_metadata(
    search_term: &str,
    series_type: &str,
    tmdb_api_key: Option<&str>,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<MetadataResult, String> {
    match series_type {
        "anime" => {
            // Bangumi first (best coverage + Chinese data), then TMDB enrichment for backdrop
            match try_bangumi(search_term, proxy_url, force).await {
                Ok(mut result) => {
                    // Try TMDB enrichment for backdrop image
                    if let Some(key) = tmdb_api_key {
                        if let Ok(tmdb_result) = try_tmdb_backdrop(search_term, key, proxy_url, force).await {
                            if result.fanart_path.is_none() {
                                result.fanart_path = Some(tmdb_result);
                            }
                        }
                    }
                    return Ok(result);
                }
                Err(_) => { /* fall through to TMDB full search */ }
            }
            if let Some(key) = tmdb_api_key {
                match try_tmdb(search_term, key, proxy_url, force).await {
                    Ok(result) => return Ok(result),
                    Err(_) => { /* no match */ }
                }
            }
        }
        "tv" | "movie" => {
            // TMDB first for TV/movies, Bangumi as fallback
            if let Some(key) = tmdb_api_key {
                match try_tmdb(search_term, key, proxy_url, force).await {
                    Ok(result) => return Ok(result),
                    Err(_) => { /* fall through */ }
                }
            }
            match try_bangumi(search_term, proxy_url, force).await {
                Ok(result) => return Ok(result),
                Err(_) => { /* no match */ }
            }
        }
        _ => {
            // Unknown type: try Bangumi then TMDB
            match try_bangumi(search_term, proxy_url, force).await {
                Ok(result) => return Ok(result),
                Err(_) => { /* fall through */ }
            }
            if let Some(key) = tmdb_api_key {
                match try_tmdb(search_term, key, proxy_url, force).await {
                    Ok(result) => return Ok(result),
                    Err(_) => { /* no match */ }
                }
            }
        }
    }

    // ── Step 3: No match ─────────────────────────────────────────────────
    Ok(MetadataResult {
        title: search_term.to_string(),
        series_type: "unknown".to_string(),
        bangumi_id: None,
        tmdb_id: None,
        synopsis: None,
        year: None,
        genres: None,
        poster_path: None,
        fanart_path: None,
        score: None,
        diagnostic: None,
    })
}

// ── Search helpers ───────────────────────────────────────────────────────────

async fn try_bangumi(
    search_term: &str,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<MetadataResult, String> {
    let bgm = BangumiClient::with_proxy(proxy_url);
    let results = bgm.search(search_term).await.map_err(|e| format!("Bangumi: {e}"))?;
    if results.is_empty() {
        return Err("Bangumi: no results".to_string());
    }
    let media = &results[0];
    if let Ok(detail) = bgm.get_by_id(media.id).await {
        build_bangumi_result(&detail, proxy_url, force).await
    } else {
        build_bangumi_search_result(media, proxy_url, force).await
    }
}

async fn try_tmdb(
    search_term: &str,
    api_key: &str,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<MetadataResult, String> {
    let tmdb = TmdbClient::new(api_key, proxy_url);

    // Try TV first
    let tv_results = tmdb.search_tv(search_term, "zh-CN", 1).await.map_err(|e| format!("TMDB TV: {e}"))?;
    if !tv_results.is_empty() {
        let tv = &tv_results[0];
        if let Ok(detail) = tmdb.get_tv_details(tv.id, "zh-CN").await {
            return build_tmdb_result("tv", &detail, proxy_url, force).await;
        }
        return build_tmdb_result("tv", tv, proxy_url, force).await;
    }

    // Try movie
    let movie_results = tmdb.search_movie(search_term, "zh-CN", 1).await.map_err(|e| format!("TMDB Movie: {e}"))?;
    if !movie_results.is_empty() {
        let movie = &movie_results[0];
        if let Ok(detail) = tmdb.get_movie_details(movie.id, "zh-CN").await {
            return build_tmdb_result("movie", &detail, proxy_url, force).await;
        }
        return build_tmdb_result("movie", movie, proxy_url, force).await;
    }

    Err("TMDB: no results".to_string())
}

/// Try TMDB TV search only for backdrop enrichment (when Bangumi already matched).
/// Returns the local fanart cache path on success.
async fn try_tmdb_backdrop(
    search_term: &str,
    api_key: &str,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<String, String> {
    let tmdb = TmdbClient::new(api_key, proxy_url);
    let tv_results = tmdb.search_tv(search_term, "zh-CN", 1).await.map_err(|e| format!("TMDB TV: {e}"))?;
    if tv_results.is_empty() {
        return Err("TMDB: no TV results for backdrop".to_string());
    }
    let tv = &tv_results[0];
    // Get detail for backdrop path
    let detail = tmdb.get_tv_details(tv.id, "zh-CN").await.map_err(|e| format!("TMDB detail: {e}"))?;
    let backdrop = detail.backdrop_path.ok_or("TMDB: no backdrop".to_string())?;
    let url = tmdb_image_url(&backdrop, "w1280");
    let cache_path = tmdb_cache_path("banner", tv.id)?;
    download_image(&url, &cache_path, proxy_url, force).await?;
    Ok(cache_path.to_string_lossy().to_string())
}

// ── ID-based fetchers ────────────────────────────────────────────────────────
pub async fn fetch_by_bangumi_id(
    bangumi_id: i32,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<MetadataResult, String> {
    let bgm = BangumiClient::with_proxy(proxy_url);
    let detail = bgm.get_by_id(bangumi_id).await?;
    build_bangumi_result(&detail, proxy_url, force).await
}

/// Fetch metadata for a known TMDB ID (manual match).
pub async fn fetch_by_tmdb_id(
    tmdb_id: i64,
    media_type: &str,
    tmdb_api_key: &str,
    language: &str,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<MetadataResult, String> {
    let tmdb = TmdbClient::new(tmdb_api_key, proxy_url);
    let detail = match media_type {
        "tv" => tmdb.get_tv_details(tmdb_id, language).await?,
        "movie" => tmdb.get_movie_details(tmdb_id, language).await?,
        _ => return Err(format!("Unsupported TMDB media type: {media_type}")),
    };
    build_tmdb_result(media_type, &detail, proxy_url, force).await
}

// ── Result builders ───────────────────────────────────────────────────────────

async fn build_bangumi_result(
    detail: &BangumiSubjectDetail,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<MetadataResult, String> {
    // Prefer Chinese name, fallback to Japanese
    let title = if detail.name_cn.is_empty() {
        detail.name.clone()
    } else {
        detail.name_cn.clone()
    };

    // Extract year from date string "YYYY-MM-DD"
    let year = detail.date[..4].parse::<i32>().ok();

    // Tags (take top 8 sorted by count)
    let mut tags: Vec<&BangumiTag> = detail.tags.iter().collect();
    tags.sort_by(|a, b| b.count.cmp(&a.count));
    let genres: Option<String> = if tags.is_empty() {
        None
    } else {
        let names: Vec<&str> = tags.iter().take(8).map(|t| t.name.as_str()).collect();
        Some(serde_json::to_string(&names).unwrap_or_default())
    };

    // Download poster (large)
    let poster_path = if let Some(ref url) = detail.images.large {
        let url = ensure_https(url);
        let cache_path = bangumi_cache_path("poster", detail.id)?;
        match download_image(&url, &cache_path, proxy_url, force).await {
            Ok(()) => Some(cache_path.to_string_lossy().to_string()),
            Err(e) => {
                eprintln!("Bangumi poster download warning: {e}");
                None
            }
        }
    } else {
        None
    };

    let diagnostic = if poster_path.is_some() {
        None
    } else {
        Some("封面下载失败 (lain.bgm.tv CDN 不可达)".to_string())
    };

    // Bangumi doesn't have banners/backdrops — leave fanart_path as None
    // (the scanner may have already detected a local fanart.jpg)

    Ok(MetadataResult {
        title,
        series_type: "anime".to_string(),
        bangumi_id: Some(detail.id as i64),
        tmdb_id: None,
        synopsis: if detail.summary.is_empty() {
            None
        } else {
            Some(detail.summary.clone())
        },
        year,
        genres,
        poster_path,
        fanart_path: None,
        score: detail.rating.as_ref().and_then(|r| r.score).map(|s| (s * 10.0).round() as i32),
        diagnostic,
    })
}

/// Build result from a search result only (detail API failed).
async fn build_bangumi_search_result(
    media: &BangumiSearchResult,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<MetadataResult, String> {
    let title = if media.name_cn.is_empty() {
        media.name.clone()
    } else {
        media.name_cn.clone()
    };

    let year = if media.air_date.len() >= 4 {
        media.air_date[..4].parse::<i32>().ok()
    } else {
        None
    };

    let poster_path = if let Some(ref url) = media.images.large {
        let url = ensure_https(url);
        let cache_path = bangumi_cache_path("poster", media.id)?;
        match download_image(&url, &cache_path, proxy_url, force).await {
            Ok(()) => Some(cache_path.to_string_lossy().to_string()),
            Err(e) => {
                eprintln!("Bangumi poster download warning: {e}");
                None
            }
        }
    } else {
        None
    };

    Ok(MetadataResult {
        title,
        series_type: "anime".to_string(),
        bangumi_id: Some(media.id as i64),
        tmdb_id: None,
        synopsis: if media.summary.is_empty() {
            None
        } else {
            Some(media.summary.clone())
        },
        year,
        genres: None, // search results don't have tags
        poster_path,
        fanart_path: None,
        score: None, // search results don't have rating
        diagnostic: None,
    })
}

async fn build_tmdb_result(
    media_type: &str,
    result: &TmdbSearchResult,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<MetadataResult, String> {
    let title = result.display_name().to_string();
    let year = result.year();

    let genres: Option<String> = match &result.genres {
        Some(gs) if !gs.is_empty() => {
            let names: Vec<&str> = gs.iter().map(|g| g.name.as_str()).collect();
            Some(serde_json::to_string(&names).unwrap_or_default())
        }
        _ => None,
    };

    // Download poster (w500)
    let poster_path = if let Some(ref path) = result.poster_path {
        let url = tmdb_image_url(path, "w500");
        let cache_path = tmdb_cache_path("poster", result.id)?;
        match download_image(&url, &cache_path, proxy_url, force).await {
            Ok(()) => Some(cache_path.to_string_lossy().to_string()),
            Err(e) => {
                eprintln!("TMDB poster download warning: {e}");
                None
            }
        }
    } else {
        None
    };

    // Download backdrop (w1280)
    let fanart_path = if let Some(ref path) = result.backdrop_path {
        let url = tmdb_image_url(path, "w1280");
        let cache_path = tmdb_cache_path("banner", result.id)?;
        match download_image(&url, &cache_path, proxy_url, force).await {
            Ok(()) => Some(cache_path.to_string_lossy().to_string()),
            Err(e) => {
                eprintln!("TMDB backdrop download warning: {e}");
                None
            }
        }
    } else {
        None
    };

    Ok(MetadataResult {
        title,
        series_type: media_type.to_string(),
        bangumi_id: None,
        tmdb_id: Some(result.id),
        synopsis: result.overview.clone(),
        year,
        genres,
        poster_path,
        fanart_path,
        score: result.vote_average.map(|v| (v * 10.0).round() as i32),
        diagnostic: None,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Bangumi search may return http:// URLs; convert to https:// for compatibility.
fn ensure_https(url: &str) -> String {
    if url.starts_with("http://") {
        url.replacen("http://", "https://", 1)
    } else {
        url.to_string()
    }
}
