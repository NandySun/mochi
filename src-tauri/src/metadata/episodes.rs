//! Episode metadata fetching from TMDB season endpoint.
//!
//! Downloads episode stills (w300) and writes titles/overviews/air_dates
//! to the local SQLite database.
//!
//! Architecture: reads then releases DB lock → async network calls →
//! re-acquires DB lock for writes. Never holds &Connection across .await.

use crate::db::{self, Episode, Series};
use crate::metadata::cache;
use crate::metadata::tmdb::{self, TmdbClient};
use rusqlite::Connection;
use std::collections::HashSet;
use std::sync::Mutex;

/// Data extracted from DB before network calls.
struct EpisodeContext {
    series: Series,
    episodes: Vec<Episode>,
}

/// Result of fetching one season's episode data from TMDB.
struct SeasonUpdate {
    season_number: i32,
    episode_updates: Vec<Episode>,
}

/// Fetch episode metadata for a series from TMDB.
///
/// The DB mutex is locked only briefly to read context and later to write
/// results; it is never held across `.await` boundaries.
pub async fn fetch_episode_metadata(
    db_mutex: &Mutex<Connection>,
    series_id: i64,
    tmdb_api_key: &str,
    proxy_url: Option<&str>,
    force: bool,
) -> Result<usize, String> {
    // ── Phase 1: Read context from DB ──────────────────────────────────
    let ctx = {
        let conn = db_mutex.lock().map_err(|e| e.to_string())?;
        let series = db::get_series_by_id(&conn, series_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Series not found".to_string())?;
        let episodes = db::get_episodes_by_series(&conn, series_id).map_err(|e| e.to_string())?;
        EpisodeContext { series, episodes }
    };
    // DB lock released here — safe for async

    // ── Phase 2: Determine TMDB ID ─────────────────────────────────────
    let tmdb_id = if let Some(id) = ctx.series.tmdb_id {
        id
    } else if ctx.series.series_type == "anime" {
        let tmdb = TmdbClient::new(tmdb_api_key, proxy_url);
        let results = tmdb
            .search_tv(&ctx.series.search_term, "zh-CN", 1)
            .await
            .map_err(|e| format!("TMDB search failed: {e}"))?;
        let found = results
            .first()
            .ok_or_else(|| "TMDB: no TV results for this anime".to_string())?;

        // Store tmdb_id for future use
        {
            let conn = db_mutex.lock().map_err(|e| e.to_string())?;
            db::update_series_metadata(
                &conn,
                series_id,
                &ctx.series.title,
                &ctx.series.series_type,
                ctx.series.bangumi_id,
                Some(found.id),
                ctx.series.synopsis.as_deref(),
                ctx.series.year,
                ctx.series.genres.as_deref(),
                ctx.series.poster_path.as_deref(),
                ctx.series.fanart_path.as_deref(),
                ctx.series.score,
            )
            .map_err(|e| e.to_string())?;
        }
        found.id
    } else {
        return Err("Series has no TMDB ID and is not anime (cannot search)".to_string());
    };

    // ── Phase 3: Collect unique seasons ────────────────────────────────
    let mut seasons: Vec<i32> = ctx
        .episodes
        .iter()
        .map(|ep| ep.season_number)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    seasons.sort();

    // ── Phase 4: Fetch season data + download stills (all async) ──────
    let tmdb = TmdbClient::new(tmdb_api_key, proxy_url);
    let mut season_updates: Vec<SeasonUpdate> = Vec::new();

    // When all episodes belong to a single season, capture season-level
    // metadata (poster, synopsis, name) to enrich the series display.
    let uniform_season = seasons.len() == 1 && ctx.series.series_type != "anime";
    let mut season_series_title: Option<String> = None;
    let mut season_series_synopsis: Option<String> = None;
    let mut season_series_poster: Option<String> = None;

    for season_num in seasons {
        let season_detail = match tmdb.get_season(tmdb_id, season_num, "zh-CN").await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("TMDB season {season_num} fetch warning: {e}");
                continue;
            }
        };

        // ── Capture season-level metadata for single-season series ──
        if uniform_season {
            // Compose display title: "哈哈哈哈哈" + "第六季" → "哈哈哈哈哈 第六季"
            if let Some(ref name) = season_detail.name {
                if !name.is_empty() && !ctx.series.title.ends_with(name) {
                    season_series_title = Some(format!("{} {}", ctx.series.title, name));
                }
            }
            // Season-specific synopsis
            season_series_synopsis = season_detail.overview.clone();
            // Season poster (download async)
            if let Some(ref poster) = season_detail.poster_path {
                let url = tmdb::tmdb_image_url(poster, "w500");
                if let Ok(cache_path) = cache::tmdb_cache_path("poster", tmdb_id) {
                    if cache::download_image(&url, &cache_path, proxy_url, true).await.is_ok() {
                        season_series_poster = Some(cache_path.to_string_lossy().to_string());
                    }
                }
            }
        }

        let mut episode_updates: Vec<Episode> = Vec::new();

        for ep_result in &season_detail.episodes {
            // Find matching local episode
            let local_ep = match ctx.episodes.iter().find(|e| {
                e.season_number == season_num && e.episode_number == ep_result.episode_number
            }) {
                Some(ep) => ep,
                None => continue,
            };

            // Download still image if available
            let still_path = if let Some(ref still) = ep_result.still_path {
                let url = tmdb::tmdb_image_url(still, "w300");
                match cache::tmdb_cache_path("still", local_ep.id) {
                    Ok(cache_path) => {
                        match cache::download_image(&url, &cache_path, proxy_url, force).await {
                            Ok(()) => Some(cache_path.to_string_lossy().to_string()),
                            Err(e) => {
                                eprintln!("Still download warning for E{:02}: {e}", local_ep.episode_number);
                                None
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Still cache path error: {e}");
                        None
                    }
                }
            } else {
                None
            };

            let updated = Episode {
                id: local_ep.id,
                series_id: local_ep.series_id,
                season_number: local_ep.season_number,
                episode_number: local_ep.episode_number,
                title: ep_result.name.clone().or(local_ep.title.clone()),
                file_path: local_ep.file_path.clone(),
                duration: local_ep.duration,
                subtitle_count: local_ep.subtitle_count,
                subtitle_paths: local_ep.subtitle_paths.clone(),
                status: local_ep.status.clone(),
                watched_progress: local_ep.watched_progress,
                watched_completed: local_ep.watched_completed,
                still_path: still_path.or(local_ep.still_path.clone()),
                still_url: ep_result
                    .still_path
                    .as_ref()
                    .map(|p| tmdb::tmdb_image_url(p, "w300"))
                    .or(local_ep.still_url.clone()),
                overview: ep_result.overview.clone().or(local_ep.overview.clone()),
                air_date: ep_result.air_date.clone().or(local_ep.air_date.clone()),
                runtime: ep_result.runtime.or(local_ep.runtime),
                created_at: local_ep.created_at.clone(),
                updated_at: String::new(),
            };

            episode_updates.push(updated);
        }

        if !episode_updates.is_empty() {
            season_updates.push(SeasonUpdate {
                season_number: season_num,
                episode_updates,
            });
        }
    }

    // ── Phase 5: Write results to DB ───────────────────────────────────
    let mut updated_count = 0usize;
    {
        let conn = db_mutex.lock().map_err(|e| e.to_string())?;

        // ── Update series-level metadata with season-specific data ──
        if season_series_title.is_some()
            || season_series_synopsis.is_some()
            || season_series_poster.is_some()
        {
            let title = season_series_title.as_deref().unwrap_or(&ctx.series.title);
            db::update_series_metadata(
                &conn,
                series_id,
                title,
                &ctx.series.series_type,
                ctx.series.bangumi_id,
                Some(tmdb_id),
                season_series_synopsis.as_deref(),
                ctx.series.year,
                ctx.series.genres.as_deref(),
                season_series_poster.as_deref(),
                ctx.series.fanart_path.as_deref(),
                ctx.series.score,
            )
            .map_err(|e| e.to_string())?;
        }

        for season_update in &season_updates {
            for ep in &season_update.episode_updates {
                db::upsert_episode(&conn, ep).map_err(|e| e.to_string())?;
                updated_count += 1;
            }
        }
    }

    Ok(updated_count)
}
