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
    pub subtitle_paths: Option<String>, // JSON array string
    pub status: String,
    pub watched_progress: i64,
    pub watched_completed: i32,
    pub still_path: Option<String>,     // 剧集缩略图本地缓存路径
    pub still_url: Option<String>,      // 剧集缩略图远程 URL（TMDB w300）
    pub overview: Option<String>,       // 剧集简介
    pub air_date: Option<String>,       // 播出日期 YYYY-MM-DD
    pub runtime: Option<i32>,           // 时长（分钟）
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Person {
    pub id: i64,
    pub source: String,         // "tmdb" | "bangumi"
    pub source_id: String,      // 源 ID（字符串，兼容 TMDB int + Bangumi int）
    pub name: String,           // 演员/声优名
    pub role_name: Option<String>, // 角色名
    pub image_url: Option<String>, // 头像远程 URL
    pub image_cache: Option<String>, // 头像本地缓存路径
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesCast {
    pub series_id: i64,
    pub person_id: i64,
    pub sort_order: i32,
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
    subtitle_paths TEXT,
    status TEXT DEFAULT 'ready',
    watched_progress INTEGER DEFAULT 0,
    watched_completed INTEGER DEFAULT 0,
    still_path TEXT,
    still_url TEXT,
    overview TEXT,
    air_date TEXT,
    runtime INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)";

const CREATE_PERSON: &str = "
CREATE TABLE IF NOT EXISTS person (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role_name TEXT,
    image_url TEXT,
    image_cache TEXT,
    UNIQUE(source, source_id)
)";

const CREATE_SERIES_CAST: &str = "
CREATE TABLE IF NOT EXISTS series_cast (
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (series_id, person_id)
)";

// ── Init ───────────────────────────────────────────────────────────────────────

/// Open (or create) the SQLite database and ensure both tables exist.
pub fn init_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    conn.execute_batch(CREATE_SERIES)?;
    conn.execute_batch(CREATE_EPISODES)?;
    conn.execute_batch(CREATE_PERSON)?;
    conn.execute_batch(CREATE_SERIES_CAST)?;
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
    // Migration: add subtitle_paths column if not present
    match conn.execute_batch("ALTER TABLE episodes ADD COLUMN subtitle_paths TEXT") {
        Ok(()) => {}
        Err(_) => { /* column already exists – ignore */ }
    }
    // Migration: add still_path column for episode thumbnails
    match conn.execute_batch("ALTER TABLE episodes ADD COLUMN still_path TEXT") {
        Ok(()) => {}
        Err(_) => {}
    }
    // Migration: add still_url column for episode thumbnail remote URLs
    match conn.execute_batch("ALTER TABLE episodes ADD COLUMN still_url TEXT") {
        Ok(()) => {}
        Err(_) => {}
    }
    // Migration: add overview column for episode descriptions
    match conn.execute_batch("ALTER TABLE episodes ADD COLUMN overview TEXT") {
        Ok(()) => {}
        Err(_) => {}
    }
    // Migration: add air_date column for episode air dates
    match conn.execute_batch("ALTER TABLE episodes ADD COLUMN air_date TEXT") {
        Ok(()) => {}
        Err(_) => {}
    }
    // Migration: add runtime column for episode duration in minutes
    match conn.execute_batch("ALTER TABLE episodes ADD COLUMN runtime INTEGER") {
        Ok(()) => {}
        Err(_) => {}
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
            duration, subtitle_count, subtitle_paths, status, watched_progress,
            watched_completed, still_path, still_url, overview, air_date, runtime,
            created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
        ON CONFLICT(file_path) DO UPDATE SET
            series_id=excluded.series_id,
            season_number=excluded.season_number,
            episode_number=excluded.episode_number,
            title=COALESCE(excluded.title, episodes.title),
            duration=excluded.duration,
            subtitle_count=excluded.subtitle_count,
            subtitle_paths=excluded.subtitle_paths,
            status=excluded.status,
            still_path=COALESCE(excluded.still_path, episodes.still_path),
            still_url=COALESCE(excluded.still_url, episodes.still_url),
            overview=COALESCE(excluded.overview, episodes.overview),
            air_date=COALESCE(excluded.air_date, episodes.air_date),
            runtime=COALESCE(excluded.runtime, episodes.runtime),
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
            ep.subtitle_paths,
            ep.status,
            ep.watched_progress,
            ep.watched_completed,
            ep.still_path,
            ep.still_url,
            ep.overview,
            ep.air_date,
            ep.runtime,
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
                duration, subtitle_count, subtitle_paths, status, watched_progress,
                watched_completed, still_path, still_url, overview, air_date, runtime,
                created_at, updated_at
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
                duration, subtitle_count, subtitle_paths, status, watched_progress,
                watched_completed, still_path, still_url, overview, air_date, runtime,
                created_at, updated_at
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
        subtitle_paths: row.get(8)?,
        status: row.get(9)?,
        watched_progress: row.get(10)?,
        watched_completed: row.get(11)?,
        still_path: row.get(12)?,
        still_url: row.get(13)?,
        overview: row.get(14)?,
        air_date: row.get(15)?,
        runtime: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

// ── Person ─────────────────────────────────────────────────────────────────

/// Upsert a person by (source, source_id). Returns the row id.
pub fn upsert_person(conn: &Connection, p: &Person) -> Result<i64> {
    conn.query_row(
        "INSERT INTO person (source, source_id, name, role_name, image_url, image_cache)
         VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(source, source_id) DO UPDATE SET
            name=excluded.name,
            role_name=excluded.role_name,
            image_url=COALESCE(excluded.image_url, person.image_url),
            image_cache=COALESCE(excluded.image_cache, person.image_cache)
         RETURNING id",
        params![
            p.source,
            p.source_id,
            p.name,
            p.role_name,
            p.image_url,
            p.image_cache,
        ],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

// ── SeriesCast ─────────────────────────────────────────────────────────────

/// Replace all cast entries for a series (delete old, insert new).
pub fn replace_series_cast(
    conn: &Connection,
    series_id: i64,
    cast: &[(i64, i32)], // (person_id, sort_order)
) -> Result<()> {
    conn.execute("DELETE FROM series_cast WHERE series_id = ?1", params![series_id])?;
    let mut stmt = conn.prepare(
        "INSERT OR REPLACE INTO series_cast (series_id, person_id, sort_order) VALUES (?1,?2,?3)",
    )?;
    for (person_id, sort_order) in cast {
        stmt.execute(params![series_id, person_id, sort_order])?;
    }
    Ok(())
}

/// Get all cast members for a series, ordered by sort_order.
/// Returns Vec<(Person, sort_order)>.
pub fn get_series_cast(conn: &Connection, series_id: i64) -> Result<Vec<(Person, i32)>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.source, p.source_id, p.name, p.role_name, p.image_url, p.image_cache, sc.sort_order
         FROM person p
         JOIN series_cast sc ON p.id = sc.person_id
         WHERE sc.series_id = ?1
         ORDER BY sc.sort_order",
    )?;
    let rows = stmt.query_map(params![series_id], |row| {
        Ok((
            Person {
                id: row.get(0)?,
                source: row.get(1)?,
                source_id: row.get(2)?,
                name: row.get(3)?,
                role_name: row.get(4)?,
                image_url: row.get(5)?,
                image_cache: row.get(6)?,
            },
            row.get::<_, i32>(7)?,
        ))
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
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
             poster_path = COALESCE(?8, poster_path),
             fanart_path = COALESCE(?9, fanart_path),
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
        "UPDATE series SET bangumi_id = NULL, tmdb_id = NULL, search_term = display_name, updated_at = datetime('now')",
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
                duration, subtitle_count, subtitle_paths, status, watched_progress,
                watched_completed, still_path, still_url, overview, air_date, runtime,
                created_at, updated_at
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
                duration, subtitle_count, subtitle_paths, status, watched_progress,
                watched_completed, still_path, still_url, overview, air_date, runtime,
                created_at, updated_at
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
