use std::fmt;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

// ── Error ──────────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum DbError {
    Sqlite(rusqlite::Error),
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::Sqlite(e) => write!(f, "SQLite error: {e}"),
        }
    }
}

impl std::error::Error for DbError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DbError::Sqlite(e) => Some(e),
        }
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sqlite(e)
    }
}

pub type Result<T> = std::result::Result<T, DbError>;

// ── Models ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Series {
    pub id: i64,
    pub title: String,
    pub folder_name: String,
    pub display_name: String,
    pub search_term: String,
    #[serde(rename = "type")]
    pub series_type: String,
    pub poster_path: Option<String>,
    pub fanart_path: Option<String>,
    pub bangumi_id: Option<i64>,
    pub tmdb_id: Option<i64>,
    pub synopsis: Option<String>,
    pub year: Option<i32>,
    pub genres: Option<String>, // JSON array string
    pub score: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub id: i64,
    pub series_id: i64,
    pub season_number: i32,
    pub episode_number: i32,
    pub title: Option<String>,
    pub file_path: String,
    pub duration: i64,
    pub subtitle_count: i32,
    pub status: String,
    pub watched_progress: i64,
    pub watched_completed: i32,
    pub created_at: String,
    pub updated_at: String,
}

// ── SQL ────────────────────────────────────────────────────────────────────────

const CREATE_SERIES: &str = "
CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    folder_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    search_term TEXT NOT NULL,
    type TEXT DEFAULT 'unknown',
    poster_path TEXT,
    fanart_path TEXT,
    bangumi_id INTEGER,
    tmdb_id INTEGER,
    synopsis TEXT,
    year INTEGER,
    genres TEXT,
    score INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)";

const CREATE_EPISODES: &str = "
CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    season_number INTEGER DEFAULT 1,
    episode_number INTEGER NOT NULL,
    title TEXT,
    file_path TEXT NOT NULL UNIQUE,
    duration INTEGER DEFAULT 0,
    subtitle_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ready',
    watched_progress INTEGER DEFAULT 0,
    watched_completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)";

// ── Init ───────────────────────────────────────────────────────────────────────

/// Open (or create) the SQLite database and ensure both tables exist.
pub fn init_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    conn.execute_batch(CREATE_SERIES)?;
    conn.execute_batch(CREATE_EPISODES)?;
    // Migration: add score column if not present (safe on both fresh and existing DBs)
    match conn.execute_batch("ALTER TABLE series ADD COLUMN score INTEGER") {
        Ok(()) => {}
        Err(_) => { /* column already exists – ignore */ }
    }
    // Migration: rename anilist_id to bangumi_id (Phase 2 cleanup)
    match conn.execute_batch("ALTER TABLE series RENAME COLUMN anilist_id TO bangumi_id") {
        Ok(()) => {}
        Err(_) => { /* already renamed or fresh DB – ignore */ }
    }
    Ok(conn)
}

// ── Series ─────────────────────────────────────────────────────────────────────

/// Insert or update a series keyed by `folder_name`. Returns the row id.
pub fn upsert_series(conn: &Connection, series: &Series) -> Result<i64> {
    conn.query_row(
        "INSERT INTO series (
            title, folder_name, display_name, search_term, type,
            poster_path, fanart_path, bangumi_id, tmdb_id, synopsis,
            year, genres, score, created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
        ON CONFLICT(folder_name) DO UPDATE SET
            title=excluded.title,
            display_name=excluded.display_name,
            search_term=excluded.search_term,
            type=excluded.type,
            poster_path=excluded.poster_path,
            fanart_path=excluded.fanart_path,
            bangumi_id=excluded.bangumi_id,
            tmdb_id=excluded.tmdb_id,
            synopsis=excluded.synopsis,
            year=excluded.year,
            genres=excluded.genres,
            score=excluded.score,
            updated_at=datetime('now')
        RETURNING id",
        params![
            series.title,
            series.folder_name,
            series.display_name,
            series.search_term,
            series.series_type,
            series.poster_path,
            series.fanart_path,
            series.bangumi_id,
            series.tmdb_id,
            series.synopsis,
            series.year,
            series.genres,
            series.score,
            series.created_at,
            series.updated_at,
        ],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

/// Return all series ordered by title.
pub fn get_all_series(conn: &Connection) -> Result<Vec<Series>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, folder_name, display_name, search_term, type,
                poster_path, fanart_path, bangumi_id, tmdb_id, synopsis,
                year, genres, score, created_at, updated_at
         FROM series ORDER BY title",
    )?;
    let rows = stmt.query_map([], |row| series_from_row(row))?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
}

/// Return a series by folder_name, or None.
pub fn get_series_by_folder(conn: &Connection, folder_name: &str) -> Result<Option<Series>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, folder_name, display_name, search_term, type,
                poster_path, fanart_path, bangumi_id, tmdb_id, synopsis,
                year, genres, score, created_at, updated_at
         FROM series WHERE folder_name = ?1",
    )?;
    let mut rows = stmt.query_map(params![folder_name], |row| series_from_row(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Return a single series by id, or `None` if it doesn't exist.
pub fn get_series_by_id(conn: &Connection, id: i64) -> Result<Option<Series>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, folder_name, display_name, search_term, type,
                poster_path, fanart_path, bangumi_id, tmdb_id, synopsis,
                year, genres, score, created_at, updated_at
         FROM series WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| series_from_row(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

fn series_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Series> {
    Ok(Series {
        id: row.get(0)?,
        title: row.get(1)?,
        folder_name: row.get(2)?,
        display_name: row.get(3)?,
        search_term: row.get(4)?,
        series_type: row.get(5)?,
        poster_path: row.get(6)?,
        fanart_path: row.get(7)?,
        bangumi_id: row.get(8)?,
        tmdb_id: row.get(9)?,
        synopsis: row.get(10)?,
        year: row.get(11)?,
        genres: row.get(12)?,
        score: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

// ── Episodes ───────────────────────────────────────────────────────────────────

/// Insert or update an episode keyed by `file_path`. Returns the row id.
pub fn upsert_episode(conn: &Connection, ep: &Episode) -> Result<i64> {
    conn.query_row(
        "INSERT INTO episodes (
            series_id, season_number, episode_number, title, file_path,
            duration, subtitle_count, status, watched_progress,
            watched_completed, created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
        ON CONFLICT(file_path) DO UPDATE SET
            series_id=excluded.series_id,
            season_number=excluded.season_number,
            episode_number=excluded.episode_number,
            title=excluded.title,
            duration=excluded.duration,
            subtitle_count=excluded.subtitle_count,
            status=excluded.status,
            updated_at=datetime('now')
        RETURNING id",
        params![
            ep.series_id,
            ep.season_number,
            ep.episode_number,
            ep.title,
            ep.file_path,
            ep.duration,
            ep.subtitle_count,
            ep.status,
            ep.watched_progress,
            ep.watched_completed,
            ep.created_at,
            ep.updated_at,
        ],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

/// Return all episodes for a series ordered by season then episode number.
pub fn get_episodes_by_series(conn: &Connection, series_id: i64) -> Result<Vec<Episode>> {
    let mut stmt = conn.prepare(
        "SELECT id, series_id, season_number, episode_number, title, file_path,
                duration, subtitle_count, status, watched_progress,
                watched_completed, created_at, updated_at
         FROM episodes WHERE series_id = ?1
         ORDER BY season_number, episode_number",
    )?;
    let rows = stmt.query_map(params![series_id], |row| episode_from_row(row))?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
}

/// Return a single episode by id, or `None` if it doesn't exist.
pub fn get_episode_by_id(conn: &Connection, id: i64) -> Result<Option<Episode>> {
    let mut stmt = conn.prepare(
        "SELECT id, series_id, season_number, episode_number, title, file_path,
                duration, subtitle_count, status, watched_progress,
                watched_completed, created_at, updated_at
         FROM episodes WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| episode_from_row(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

fn episode_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Episode> {
    Ok(Episode {
        id: row.get(0)?,
        series_id: row.get(1)?,
        season_number: row.get(2)?,
        episode_number: row.get(3)?,
        title: row.get(4)?,
        file_path: row.get(5)?,
        duration: row.get(6)?,
        subtitle_count: row.get(7)?,
        status: row.get(8)?,
        watched_progress: row.get(9)?,
        watched_completed: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

// ── Metadata helpers (Phase 2) ──────────────────────────────────────────────

/// Update series metadata after a fetch from AniList or TMDB.
pub fn update_series_metadata(conn: &Connection, series_id: i64, title: &str, series_type: &str, bangumi_id: Option<i64>, tmdb_id: Option<i64>, synopsis: Option<&str>, year: Option<i32>, genres: Option<&str>, poster_path: Option<&str>, fanart_path: Option<&str>, score: Option<i32>) -> Result<()> {
    conn.execute(
        "UPDATE series
         SET title = ?1,
             type = ?2,
             bangumi_id = ?3,
             tmdb_id = ?4,
             synopsis = COALESCE(?5, synopsis),
             year = COALESCE(?6, year),
             genres = COALESCE(?7, genres),
             poster_path = COALESCE(poster_path, ?8),
             fanart_path = COALESCE(fanart_path, ?9),
             score = COALESCE(?11, score),
             updated_at = datetime('now')
         WHERE id = ?10",
        params![
            title,
            series_type,
            bangumi_id,
            tmdb_id,
            synopsis,
            year,
            genres,
            poster_path,
            fanart_path,
            series_id,
            score,
        ],
    )?;
    Ok(())
}

/// Update just the search term for a series (used for manual correction).
pub fn update_series_search_term(conn: &Connection, series_id: i64, new_term: &str) -> Result<()> {
    conn.execute(
        "UPDATE series SET search_term = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![new_term, series_id],
    )?;
    Ok(())
}

/// Update the series type (anime/tv/movie/unknown). Used by the detail page type dropdown.
pub fn update_series_type(conn: &Connection, series_id: i64, new_type: &str) -> Result<()> {
    conn.execute(
        "UPDATE series SET type = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![new_type, series_id],
    )?;
    Ok(())
}

/// Clear all metadata IDs and search_term overrides from the DB.
/// Preserves series.type (user-set type). Used by "clear all verdicts".
pub fn clear_all_metadata_ids(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE series SET bangumi_id = NULL, tmdb_id = NULL, search_term = NULL, updated_at = datetime('now')",
        [],
    )?;
    Ok(())
}

// ── Playback helpers ───────────────────────────────────────────────────────────

/// Update the watch progress for an episode. Marks it completed (>95 % of duration).
pub fn update_watch_progress(
    conn: &Connection,
    episode_id: i64,
    progress_secs: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE episodes
         SET watched_progress = ?1,
             watched_completed = CASE
                 WHEN duration > 0 AND (?1 * 100 / duration) > 95 THEN 1
                 ELSE 0
             END,
             updated_at = datetime('now')
         WHERE id = ?2",
        params![progress_secs, episode_id],
    )?;
    Ok(())
}

/// Return just the file path for an episode (used by the player).
pub fn get_episode_path(conn: &Connection, episode_id: i64) -> Result<Option<String>> {
    conn.query_row(
        "SELECT file_path FROM episodes WHERE id = ?1",
        params![episode_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

/// Return the most recently watched episode with progress > 0 and not completed.
pub fn get_resume_episode(conn: &Connection) -> Result<Option<Episode>> {
    conn.query_row(
        "SELECT id, series_id, season_number, episode_number, title, file_path,
                duration, subtitle_count, status, watched_progress,
                watched_completed, created_at, updated_at
         FROM episodes
         WHERE watched_progress > 0 AND watched_completed = 0
         ORDER BY updated_at DESC
         LIMIT 1",
        [],
        |row| episode_from_row(row),
    )
    .optional()
    .map_err(Into::into)
}

/// Return the most recently watched episode for a specific series.
pub fn get_series_resume_episode(conn: &Connection, series_id: i64) -> Result<Option<Episode>> {
    conn.query_row(
        "SELECT id, series_id, season_number, episode_number, title, file_path,
                duration, subtitle_count, status, watched_progress,
                watched_completed, created_at, updated_at
         FROM episodes
         WHERE series_id = ?1 AND watched_progress > 0 AND watched_completed = 0
         ORDER BY updated_at DESC
         LIMIT 1",
        params![series_id],
        |row| episode_from_row(row),
    )
    .optional()
    .map_err(Into::into)
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/// Delete episodes whose file_path no longer exists on disk,
/// and series that are left with no episodes.
pub fn delete_missing_episodes(conn: &Connection) -> Result<()> {
    // Collect episode ids to delete
    let mut stmt = conn.prepare("SELECT id, file_path FROM episodes")?;
    let to_delete: Vec<i64> = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?
        .filter_map(|r| r.ok())
        .filter(|(_, path)| !std::path::Path::new(path).exists())
        .map(|(id, _)| id)
        .collect();

    if !to_delete.is_empty() {
        for id in &to_delete {
            conn.execute("DELETE FROM episodes WHERE id = ?1", params![id])?;
        }
    }

    // Remove series that have no remaining episodes
    conn.execute(
        "DELETE FROM series WHERE id NOT IN (SELECT DISTINCT series_id FROM episodes)",
        [],
    )?;

    Ok(())
}
