//! Cast / character metadata fetching.
//!
//! Routes by series type:
//! * anime → Bangumi /v0/subjects/{id}/characters (character images + voice actors)
//! * tv / movie → TMDB /{type}/{id}/credits (actor photos + character names)
//!
//! Architecture: reads then releases DB lock → async network calls →
//! re-acquires DB lock for writes. Never holds &Connection across .await.
//!
//! Each Person represents one UI cast card: primary name + secondary name + avatar.

use crate::db::{self, Person, Series};
use crate::metadata::bangumi::{BangumiClient, BangumiCharacter};
use crate::metadata::cache;
use crate::metadata::tmdb::{self, TmdbClient, TmdbCastMember};
use rusqlite::Connection;
use std::sync::Mutex;

/// Fetch cast data for a series and store in the database.
/// Returns the number of cast members added/updated.
pub async fn fetch_cast(
    db_mutex: &Mutex<Connection>,
    series_id: i64,
    tmdb_api_key: Option<&str>,
    proxy_url: Option<&str>,
) -> Result<usize, String> {
    // ── Phase 1: Read series from DB ───────────────────────────────────
    let series = {
        let conn = db_mutex.lock().map_err(|e| e.to_string())?;
        db::get_series_by_id(&conn, series_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Series not found".to_string())?
    };
    // DB lock released

    // ── Phase 2: Fetch cast data (async, no DB lock) ──────────────────
    let cast_data: Vec<(Person, i32)> = match series.series_type.as_str() {
        "anime" => {
            // Try Bangumi first, fallback to TMDB if Bangumi unavailable
            if let Some(bid) = series.bangumi_id.filter(|&id| id > 0) {
                let bgm = BangumiClient::with_proxy(proxy_url);
                match bgm.get_characters(bid as i32).await {
                    Ok(chars) => build_anime_cast(&chars, proxy_url).await,
                    Err(_) if series.tmdb_id.is_some() && tmdb_api_key.is_some() => {
                        // Bangumi failed, use TMDB credits
                        let tmdb = TmdbClient::new(tmdb_api_key.unwrap(), proxy_url);
                        let credits = tmdb
                            .get_credits("tv", series.tmdb_id.unwrap(), "zh-CN")
                            .await
                            .map_err(|e| format!("TMDB credits: {e}"))?;
                        build_tmdb_cast(&credits.cast, proxy_url).await
                    }
                    Err(e) => return Err(format!("Bangumi characters: {e}")),
                }
            } else if let Some(tid) = series.tmdb_id {
                // No Bangumi ID available, use TMDB directly
                let key = tmdb_api_key.ok_or("TMDB API key required for cast fallback")?;
                let tmdb = TmdbClient::new(key, proxy_url);
                let credits = tmdb
                    .get_credits("tv", tid, "zh-CN")
                    .await
                    .map_err(|e| format!("TMDB credits: {e}"))?;
                build_tmdb_cast(&credits.cast, proxy_url).await
            } else {
                return Err("Series has neither Bangumi ID nor TMDB ID".to_string());
            }
        }
        "tv" | "movie" => {
            let key = tmdb_api_key.ok_or("TMDB API key required for cast")?;
            let tmdb_id = series
                .tmdb_id
                .ok_or_else(|| "Series has no TMDB ID".to_string())?;
            let media_type = if series.series_type == "movie" { "movie" } else { "tv" };
            let tmdb = TmdbClient::new(key, proxy_url);
            let credits = tmdb
                .get_credits(media_type, tmdb_id, "zh-CN")
                .await
                .map_err(|e| format!("TMDB credits: {e}"))?;
            build_tmdb_cast(&credits.cast, proxy_url).await
        }
        _ => return Err("Unknown series type; cannot determine cast source".to_string()),
    };

    if cast_data.is_empty() {
        return Ok(0);
    }

    // ── Phase 3: Write to DB ───────────────────────────────────────────
    let conn = db_mutex.lock().map_err(|e| e.to_string())?;
    let mut person_ids: Vec<(i64, i32)> = Vec::new();

    for (person, sort_order) in &cast_data {
        let person_id = db::upsert_person(&conn, person).map_err(|e| e.to_string())?;
        person_ids.push((person_id, *sort_order));
    }

    db::replace_series_cast(&conn, series_id, &person_ids).map_err(|e| e.to_string())?;

    Ok(person_ids.len())
}

/// Build Person records from Bangumi characters.
/// Each character → Person { name: character name, role_name: voice actor name }.
async fn build_anime_cast(
    characters: &[BangumiCharacter],
    proxy_url: Option<&str>,
) -> Vec<(Person, i32)> {
    let mut result: Vec<(Person, i32)> = Vec::new();

    for (idx, ch) in characters.iter().enumerate() {
        let sort_order = idx as i32;

        let actor_name = ch
            .actors
            .as_ref()
            .and_then(|actors| actors.first())
            .map(|a| a.name.clone());

        let image_url = ch
            .images
            .as_ref()
            .and_then(|imgs| imgs.grid.clone().or(imgs.small.clone()));

        let image_cache = if let Some(ref url) = image_url {
            let url = ensure_https(url);
            match cache::bangumi_cache_path("char", ch.id) {
                Ok(cache_path) => {
                    match cache::download_image(&url, &cache_path, proxy_url, false).await {
                        Ok(()) => Some(cache_path.to_string_lossy().to_string()),
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            }
        } else {
            None
        };

        result.push((
            Person {
                id: 0,
                source: "bangumi".to_string(),
                source_id: ch.id.to_string(),
                name: ch.name.clone(),
                role_name: actor_name,
                image_url,
                image_cache,
            },
            sort_order,
        ));
    }

    result
}

/// Build Person records from TMDB cast members.
/// Each cast member → Person { name: actor name, role_name: character name }.
async fn build_tmdb_cast(
    cast: &[TmdbCastMember],
    proxy_url: Option<&str>,
) -> Vec<(Person, i32)> {
    let mut result: Vec<(Person, i32)> = Vec::new();

    for member in cast {
        let image_url = member
            .profile_path
            .as_ref()
            .map(|p| tmdb::tmdb_image_url(p, "w185"));

        let image_cache = if let Some(ref url) = image_url {
            match cache::tmdb_cache_path("cast", member.id) {
                Ok(cache_path) => {
                    match cache::download_image(url, &cache_path, proxy_url, false).await {
                        Ok(()) => Some(cache_path.to_string_lossy().to_string()),
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            }
        } else {
            None
        };

        result.push((
            Person {
                id: 0,
                source: "tmdb".to_string(),
                source_id: member.id.to_string(),
                name: member.name.clone(),
                role_name: member.character.clone(),
                image_url,
                image_cache,
            },
            member.order,
        ));
    }

    result
}

fn ensure_https(url: &str) -> String {
    if url.starts_with("http://") {
        url.replacen("http://", "https://", 1)
    } else {
        url.to_string()
    }
}
