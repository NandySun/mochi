use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use walkdir::WalkDir;

use crate::mochi_file;

/// Video file extensions (lowercase)
const VIDEO_EXTS: &[&str] = &["mkv", "mp4", "ts", "avi", "mov", "webm", "m2ts"];

/// Subtitle file extensions (lowercase)
const SUB_EXTS: &[&str] = &["ass", "ssa", "srt", "sub", "vtt", "idx"];

/// Temp/downloading file extensions (lowercase)
const TEMP_EXTS: &[&str] = &["aria2", "part", "crdownload", "!ut"];

/// Cover image filenames that map to poster (case-insensitive)
const POSTER_NAMES: &[&str] = &["poster.jpg", "cover.jpg", "poster.png", "cover.png"];

/// Cover image filenames that map to fanart/backdrop (case-insensitive)
const FANART_NAMES: &[&str] = &["fanart.jpg", "backdrop.jpg", "fanart.png", "backdrop.png"];

/// Regex patterns for episode number extraction, in priority order.
fn ep_patterns() -> &'static [(Regex, bool)] {
    static PATTERNS: LazyLock<Vec<(Regex, bool)>> = LazyLock::new(|| {
        vec![
            // 1. EXX / _EXX  →  episode only, with optional 上下/ab half-ep suffix
            (Regex::new(r"(?i)(?:^|_)E(\d{1,3})([上下ab])?").unwrap(), false),
            // 2. 第XX集 →  episode only
            (Regex::new(r"第(\d{1,3})集").unwrap(), false),
            // 3. SXXEYY →  season + episode
            (Regex::new(r"[Ss](\d{1,2})[Ee](\d{1,3})").unwrap(), true),
            // 4.  - XX  →  episode only (space-dash-space-digit or dash-digit at word boundary)
            (Regex::new(r"\s[-–]\s*(\d{1,3})\b").unwrap(), false),
            // 5. [XX]   →  episode only (bracket notation)
            (Regex::new(r"\[(\d{1,2})\]").unwrap(), false),
            // 6. EPXX   →  episode only
            (Regex::new(r"(?i)EP(\d{1,3})\b").unwrap(), false),
            // 7. #XX    →  episode only
            (Regex::new(r"#(\d{1,3})\b").unwrap(), false),
            // 8. 第XX話 →  episode only (Japanese notation)
            (Regex::new(r"第(\d{1,3})話").unwrap(), false),
        ]
    });
    &PATTERNS
}

/// Keywords whose presence in a filename causes it to be excluded from scanning.
/// Matching is case-insensitive against the whole filename (stem + extension).
const EXCLUDED_KEYWORDS: &[&str] = &[
    "ncop",
    "nced",
    "sp",
    "trailer",
    "preview",
    "menu",
    "creditless",
];

/// Check whether a filename contains any excluded keyword.
/// Returns true if the file should be skipped entirely.
fn is_excluded(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    EXCLUDED_KEYWORDS.iter().any(|kw| lower.contains(kw))
}

/// When exact stem matching yields no results, falls back to episode-number matching
/// (extracts episode info from subtitle filenames using the same regex patterns).
fn count_subtitles(
    root_subs: &[PathBuf],
    sub_dir_files: &[PathBuf],
    video_stem_lower: &str,
    episode_number: i32,
) -> (i32, Vec<String>) {
    let match_sub = |sub: &&PathBuf| -> bool {
        sub.file_stem()
            .and_then(|s| s.to_str())
            .map(|sub_stem| {
                let s = sub_stem.to_lowercase();
                s == video_stem_lower
                    || s.starts_with(&format!("{}.", video_stem_lower))
                    || s.starts_with(&format!("{}_", video_stem_lower))
            })
            .unwrap_or(false)
    };
    let matched_root: Vec<String> = root_subs
        .iter()
        .filter(match_sub)
        .map(|p| normalize_path(p))
        .collect();
    let matched_sub: Vec<String> = sub_dir_files
        .iter()
        .filter(match_sub)
        .map(|p| normalize_path(p))
        .collect();
    let exact_count = matched_root.len() + matched_sub.len();
    if exact_count > 0 {
        let mut paths = matched_root;
        paths.extend(matched_sub);
        return (exact_count as i32, paths);
    }

    // ── Fallback: episode-number matching for differently-named subs ──
    // Triggered only when exact stem match finds nothing, e.g.
    // video: "[YakuboEncodes] Cowboy Bebop - 01.mkv"
    // sub:   "[TxxZ] Cowboy_Bebop [01].ass"
    let all_subs: Vec<&PathBuf> = root_subs.iter().chain(sub_dir_files.iter()).collect();
    let matched_by_ep: Vec<String> = all_subs
        .iter()
        .filter(|sub| {
            sub.file_name()
                .and_then(|n| n.to_str())
                .map(|name| {
                    extract_episode_info(name)
                        .map(|(_, ep, _)| ep == episode_number)
                        .unwrap_or(false)
                })
                .unwrap_or(false)
        })
        .map(|p| normalize_path(p))
        .collect();
    let count = matched_by_ep.len() as i32;
    (count, matched_by_ep)
}

/// Canonicalize and normalize a path for mpv compatibility.
fn normalize_path(path: &Path) -> String {
    let abs = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    let s = abs.to_string_lossy().to_string();
    let s = s.strip_prefix("\\\\?\\").unwrap_or(&s);
    s.replace('\\', "/")
}

// ── Output types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub series: Vec<SeriesScan>,
    /// Series whose type could not be determined (no .mochi, no suffix, no parent hint).
    /// Frontend uses this to show the verdict banner.
    pub ambiguous: Vec<SeriesScan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesScan {
    pub folder_name: String,
    pub display_name: String,
    pub search_term: String,
    pub poster_path: Option<String>,
    pub fanart_path: Option<String>,
    /// Type hint from parent folder: "anime", "tv", "movie", or None
    pub series_type_hint: Option<String>,
    pub episodes: Vec<EpisodeScan>,
    /// Absolute path to the series folder (for .mochi write-back).
    /// Empty string for flat-mode virtual series (use .mochi/ instead).
    pub folder_path: String,
    /// Absolute path to the series-level `fonts/` directory (case-insensitive).
    /// `None` when no `fonts/` subdirectory exists.
    pub fonts_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeScan {
    pub file_path: String,
    pub file_name: String,
    pub episode_number: i32,
    pub season_number: i32,
    pub title: Option<String>,
    pub subtitle_count: i32,
    pub subtitle_paths: Vec<String>,
    pub status: String, // "ready" | "downloading"
    /// How the episode number was determined: "regex" (C1 pattern match) or "fallback" (C2 auto-assignment).
    /// Reserved for future UI marking; frontend does not consume this yet.
    pub match_method: String,
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

/// Split folder name on the last underscore: "黄泉使者_Yomi no Tsugai"
/// → display = "黄泉使者", search = "Yomi no Tsugai"
/// Clean noise from anime folder names: strip release group tags, encoding metadata,
/// episode range info, and other non-title cruft. Preserves the actual show title.
fn clean_anime_folder_name(raw: &str) -> String {
    // ── Regex for metadata keywords (case-insensitive, no boundary requirement) ──
    static META_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)(\d{3,4}[px]|hevc|avc|flac|aac|dts|atmos|ac3|dual\s*audio|10bit|8bit|bdrip|dvd|web-dl|webrip|bluray|remux|简繁|外挂|内封|内嵌|字幕|\bmkv\b|\bmp4\b|hi10p|av1|5\.1|2\.0)").unwrap()
    });

    // ── Regex for episode range patterns ──────────────────────────
    static RANGE_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\d{1,3}\s*[~～\-–]\s*\d{1,3}|\d{1,3}-\d{1,3}.*(?:[Tt][Vv]|全集)").unwrap()
    });

    // ── Collect all bracket segments with classification ──────────
    static BRACKET_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[([^\]]+)\]").unwrap());

    let bracket_matches: Vec<(usize, usize, String, bool)> = BRACKET_RE
        .captures_iter(raw)
        .enumerate()
        .map(|(idx, cap)| {
            let m = cap.get(0).unwrap();
            let content = cap[1].to_string();
            let is_first = idx == 0;
            let is_group = is_first
                && content.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
                && content.len() <= 20
                && !content.contains('\u{4e00}'); // no CJK
            let is_meta = META_RE.is_match(&content);
            let is_range = RANGE_RE.is_match(&content);
            let keep = !is_group && !is_meta && !is_range;
            (m.start(), m.end(), content, keep)
        })
        .collect();

    // ── Rebuild: keep non-bracket text + kept brackets ─────────────
    let mut result = String::new();
    let mut cursor = 0usize;
    for (start, end, _, keep) in &bracket_matches {
        // Add text before this bracket
        if *start > cursor {
            result.push_str(&raw[cursor..*start]);
        }
        // Add bracket content if kept (strip brackets)
        if *keep {
            result.push_str(&raw[*start+1..*end-1]);
        }
        cursor = *end;
    }
    // Add remaining text after last bracket
    if cursor < raw.len() {
        result.push_str(&raw[cursor..]);
    }

    if result.is_empty() {
        return raw.to_string();
    }

    // ── Step 2: Strip non-bracket noise from the cleaned text ──────
    let trimmed = result.trim().trim_matches('-').trim_matches('+').trim();

    // Remove substrings matching common noise patterns
    static NOISE_RES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
        vec![
            Regex::new(r"(?i)\s*BD[-\s]*BOX\s*").unwrap(),
            Regex::new(r"(?i)\s*-\s*TV\s*").unwrap(),
            Regex::new(r"\s*\+\s*SP\s*").unwrap(),
            Regex::new(r"\s*\+\s*Movie\s*").unwrap(),
            Regex::new(r"\s+-\s*\d{1,3}\s*[~～]\s*\d{1,3}\s*").unwrap(),
            Regex::new(r"\s+Subs\s*$").unwrap(),
        ]
    });

    let mut cleaned = trimmed.to_string();
    for re in NOISE_RES.iter() {
        cleaned = re.replace_all(&cleaned, " ").to_string();
    }

    let final_clean = cleaned.trim().trim_matches('-').trim_matches('+').trim();
    if final_clean.is_empty() {
        raw.to_string()
    } else {
        final_clean.to_string()
    }
}

fn parse_folder_name(folder: &str) -> (String, String) {
    if let Some(pos) = folder.rfind('_') {
        let display = folder[..pos].to_string();
        let search = folder[pos + 1..].to_string();
        (display, search)
    } else {
        (folder.to_string(), folder.to_string())
    }
}

/// Folder name suffix regex for type-hint: "黄泉使者 [tv]" → type=tv
static FOLDER_SUFFIX_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[(anime|tv|movie|variety)\]$").unwrap());

/// Extract type-hint from folder name suffix, e.g. "黄泉使者 [tv]" → Some("tv").
/// Returns (display_name_without_suffix, type_hint).
fn parse_folder_suffix(folder: &str) -> (String, Option<String>) {
    if let Some(caps) = FOLDER_SUFFIX_RE.captures(folder) {
        let type_hint = caps.get(1).map(|m| m.as_str().to_string());
        let display = FOLDER_SUFFIX_RE.replace(folder, "").trim().to_string();
        (display, type_hint)
    } else {
        (folder.to_string(), None)
    }
}

/// Resolve type-hint for a series using the multi-source priority chain:
/// 1. .mochi file in the series folder
/// 2. Folder name suffix [anime]/[tv]/[movie]
/// 3. Parent folder name (anime/tv/movie/teleplay)
/// 4. None → unknown
///
/// Returns (type_hint, display_name_override).
/// display_name_override is Some when the folder suffix was stripped.
fn resolve_type_hint(
    dir_path: &Path,
    folder_name: &str,
    parent_type_hint: Option<&str>,
) -> (Option<String>, Option<String>) {
    // 1. .mochi file
    if let Ok(mochi) = mochi_file::read_mochi(dir_path) {
        if let Some(t) = mochi.series_type {
            return (Some(t), None);
        }
    }

    // 2. Folder name suffix
    let (display_no_suffix, suffix_hint) = parse_folder_suffix(folder_name);
    if suffix_hint.is_some() {
        let display_override = if display_no_suffix != folder_name {
            Some(display_no_suffix)
        } else {
            None
        };
        return (suffix_hint, display_override);
    }

    // 3. Parent folder
    if let Some(hint) = parent_type_hint {
        return (Some(hint.to_string()), None);
    }

    // 4. Unknown
    (None, None)
}

/// Re-derive the type of a series by searching the filesystem for its folder.
/// Used by `fetch_metadata` to fix stale DB types (e.g. polluted by TMDB fallback).
///
/// Walks `root_paths` looking for a directory matching `folder_name`,
/// then applies the same multi-source resolution as the scanner.
pub fn resolve_type_from_filesystem(root_paths: &[String], folder_name: &str) -> Option<String> {
    const TYPE_HINTS: &[(&str, &str)] = &[
        ("anime", "anime"),
        ("tv", "tv"),
        ("movie", "movie"),
        ("variety", "variety"),
        ("teleplay", "tv"),
    ];

    for root_path in root_paths {
        let root = Path::new(root_path);

        // Check depth-1: root/folder_name/
        let direct = root.join(folder_name);
        if direct.is_dir() {
            let (type_hint, _) = resolve_type_hint(&direct, folder_name, None);
            if type_hint.is_some() {
                return type_hint;
            }
        }

        // Check depth-2: root/container/folder_name/
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let container_path = entry.path();
                if !container_path.is_dir() {
                    continue;
                }
                let container_name = entry.file_name().to_string_lossy().to_string();
                let parent_hint = TYPE_HINTS
                    .iter()
                    .find(|(h, _)| h.eq_ignore_ascii_case(&container_name))
                    .map(|(_, t)| *t);

                let series_path = container_path.join(folder_name);
                if series_path.is_dir() {
                    let (type_hint, _) = resolve_type_hint(&series_path, folder_name, parent_hint);
                    if type_hint.is_some() {
                        return type_hint;
                    }
                }
            }
        }
    }

    None
}

/// Extract episode number and optionally season number from a filename.
/// Returns (season_number, episode_number, season_explicit) or None if no pattern matched.
/// `season_explicit` is true when the season came from an SXXEYY pattern, false when it defaulted to 1.
fn extract_episode_info(filename: &str) -> Option<(i32, i32, bool)> {
    // Track the first pattern index for half-episode conversion (only pattern 0)
    for (idx, (re, has_season)) in ep_patterns().iter().enumerate() {
        if let Some(caps) = re.captures(filename) {
            if *has_season {
                // SXXEYY pattern — season is explicit
                let s: i32 = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(1);
                let e: i32 = caps.get(2).and_then(|m| m.as_str().parse().ok())?;
                return Some((s, e, true));
            } else {
                let mut e: i32 = caps.get(1).and_then(|m| m.as_str().parse().ok())?;
                // Pattern 0 (E01上 / E11a style): apply half-episode conversion
                if idx == 0 {
                    if let Some(suffix) = caps.get(2) {
                        let s = suffix.as_str().to_lowercase();
                        if s == "上" || s == "a" {
                            e = e * 2 - 1;  // 上半集 → 2N-1
                        } else if s == "下" || s == "b" {
                            e = e * 2;      // 下半集 → 2N
                        }
                    }
                }
                return Some((1, e, false));
            }
        }
    }
    None
}

/// Parse a Chinese numeral string to i32, e.g. "六" → 6, "十二" → 12, "二十一" → 21.
/// Returns None if the string is not a recognizable Chinese numeral.
fn parse_chinese_numeral(s: &str) -> Option<i32> {
    if s.is_empty() {
        return None;
    }
    // Single-digit lookup
    if s.len() == 1 {
        return match s {
            "一" => Some(1), "二" => Some(2), "三" => Some(3), "四" => Some(4),
            "五" => Some(5), "六" => Some(6), "七" => Some(7), "八" => Some(8),
            "九" => Some(9), "十" => Some(10),
            _ => None,
        };
    }
    // Multi-character: "十二" → 10+2, "二十一" → 2*10+1, "一百二十" → 1*100+20
    let chars: Vec<char> = s.chars().collect();
    let mut total = 0i32;
    let mut section = 0i32;
    for &c in &chars {
        match c {
            '一' => section += 1,
            '二' => section += 2,
            '三' => section += 3,
            '四' => section += 4,
            '五' => section += 5,
            '六' => section += 6,
            '七' => section += 7,
            '八' => section += 8,
            '九' => section += 9,
            '十' => {
                if section == 0 { section = 1; }
                total += section * 10;
                section = 0;
            }
            '百' => {
                if section == 0 { section = 1; }
                total += section * 100;
                section = 0;
            }
            _ => return None, // unrecognized character
        }
    }
    total += section;
    if total == 0 {
        None
    } else {
        Some(total)
    }
}

/// Extract season number from a folder/prefix name, e.g. "哈哈哈哈哈 第六季" → ("哈哈哈哈哈", Some(6)).
/// Also detects patterns like "Season 3", "S3", and Chinese numerals (第X季).
/// Returns (cleaned_name, season_number).
pub(crate) fn extract_season_from_name(name: &str) -> (String, Option<i32>) {
    static SEASON_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[\s\-–]*第\s*([\d一二三四五六七八九十百千]+)\s*季$|[\s\-–]*[Ss]eason\s*(\d+)$|[\s\-–]*[Ss](\d+)$").unwrap());
    if let Some(caps) = SEASON_RE.captures(name) {
        let raw = caps.get(1)
            .or_else(|| caps.get(2))
            .or_else(|| caps.get(3));
        let season: Option<i32> = raw.and_then(|m| {
            let s = m.as_str();
            // Try ASCII integer first, then Chinese numeral
            s.parse::<i32>().ok()
                .or_else(|| parse_chinese_numeral(s))
        });
        if let Some(s) = season {
            let cleaned = SEASON_RE.replace(name, "").to_string();
            return (cleaned, Some(s));
        }
    }
    (name.to_string(), None)
}

/// Get lowercase extension without the dot.
fn ext_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
}

/// Get the lowercase filename.
fn filename_lower(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_lowercase())
}

// ── Main scan function ────────────────────────────────────────────────────────

/// Recursively scan a root directory.
///
/// ## Type-hint folders (Phase 2)
///
/// If the root contains folders named `anime`, `tv`, `movie`, or `teleplay`
/// (case-insensitive), they are treated as type-hint containers: all series
/// inside inherit that type. This replaces language-based guessing in dual-search.
///
/// If `root_type` is provided (and not "auto"), all depth-1 series inherit this type
/// unless overridden by a more specific source (.mochi, folder suffix).
///
/// If no type-hint folders exist, depth-1 folders are treated as series directly
/// (backward compatible with Phase 1 flat layout).
///
/// Examples:
/// ```text
/// D:\Video\
///   anime\                         ← type hint
///     黄泉使者_Yomi no Tsugai\      → type=anime
///   tv\
///     太阳星辰\                     → type=tv
///   上伊那牡丹_Kamiina Botan\        ← no hint → type=unknown (or root_type if set)
/// ```
/// Check if a directory has any video files at depth 1 (not inside subdirectories).
fn has_video_at_depth1(dir: &Path) -> bool {
    for entry in WalkDir::new(dir).min_depth(1).max_depth(1).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if let Some(ext) = entry.path().extension().and_then(|x| x.to_str()) {
                if VIDEO_EXTS.contains(&ext.to_lowercase().as_str()) {
                    return true;
                }
            }
        }
    }
    false
}

/// Build a SeriesScan from a single series folder.
fn build_series_scan(
    dir_path: &Path,
    folder_name: &str,
    display_override: Option<String>,
    resolved_type: Option<String>,
) -> Result<Option<SeriesScan>, String> {
    let base_display = display_override.unwrap_or_else(|| folder_name.to_string());
    let (base_clean, folder_season) = extract_season_from_name(&base_display);
    let cleaned = clean_anime_folder_name(&base_clean);
    let (display_name, search_term) = parse_folder_name(&cleaned);

    let (episodes, poster_path, fanart_path) =
        scan_series_folder(dir_path, folder_season)?;
    if episodes.is_empty() {
        return Ok(None);
    }

    let fonts_dir = find_fonts_dir(dir_path);

    Ok(Some(SeriesScan {
        folder_name: folder_name.to_string(),
        display_name,
        search_term,
        poster_path,
        fanart_path,
        series_type_hint: resolved_type,
        episodes,
        folder_path: dir_path.to_string_lossy().to_string(),
        fonts_dir,
    }))
}

/// Find the series-level fonts directory. Case-insensitive match on `fonts` (direct
/// subdirectory only). Returns the absolute path if found, `None` otherwise.
///
/// Used by both initial scan and rescan paths so the DB stays in sync with the
/// filesystem — when the user removes the `fonts/` directory, the next scan
/// overwrites the stored path to `None`.
pub(crate) fn find_fonts_dir(dir_path: &Path) -> Option<String> {
    std::fs::read_dir(dir_path).ok()?.find_map(|entry| {
        let entry = entry.ok()?;
        if !entry.file_type().ok()?.is_dir() {
            return None;
        }
        let name = entry.file_name().to_str()?.to_string();
        if name.eq_ignore_ascii_case("fonts") {
            Some(entry.path().to_string_lossy().to_string())
        } else {
            None
        }
    })
}

pub fn scan_library(root_path: &str, root_type: Option<&str>) -> Result<ScanResult, String> {
    let root = Path::new(root_path);
    if !root.is_dir() {
        return Err(format!("Root path is not a directory: {}", root_path));
    }

    const TYPE_HINTS: &[(&str, &str)] = &[
        ("anime", "anime"),
        ("tv", "tv"),
        ("movie", "movie"),
        ("variety", "variety"),
        ("teleplay", "tv"),
    ];

    let mut series_list: Vec<SeriesScan> = Vec::new();
    let mut flat_video_files: Vec<PathBuf> = Vec::new();

    // Iterate depth-1 entries
    for entry in WalkDir::new(root)
        .min_depth(1)
        .max_depth(1)
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
    {
        // Collect flat video files for clustering
        if entry.file_type().is_file() {
            if let Some(ext) = ext_lower(entry.path()) {
                if VIDEO_EXTS.contains(&ext.as_str()) {
                    let file_name = entry
                        .file_name()
                        .to_str()
                        .unwrap_or("");
                    if !is_excluded(file_name) {
                        flat_video_files.push(entry.path().to_path_buf());
                    }
                }
            }
            continue;
        }

        if !entry.file_type().is_dir() {
            continue;
        }

        let entry_name = entry
            .file_name()
            .to_str()
            .unwrap_or("");

        // Check if this is a type-hint container folder
        let type_hint = TYPE_HINTS
            .iter()
            .find(|(hint, _)| hint.eq_ignore_ascii_case(entry_name))
            .map(|(_, t)| t.to_string());

        if let Some(hint) = type_hint {
            // Recurse into type-hint folder: each subfolder is a series
            for sub_entry in WalkDir::new(entry.path())
                .min_depth(1)
                .max_depth(1)
                .sort_by_file_name()
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if !sub_entry.file_type().is_dir() {
                    continue;
                }
                let folder_name = sub_entry
                    .file_name()
                    .to_str()
                    .unwrap_or("")
                    .to_string();
                if folder_name.starts_with('.') {
                    continue;
                }

                // Multi-source type-hint resolution
                let (resolved_type, display_override) =
                    resolve_type_hint(sub_entry.path(), &folder_name, Some(&hint));

                if has_video_at_depth1(sub_entry.path()) {
                    // Flat series: scan the folder directly
                    if let Some(s) = build_series_scan(
                        sub_entry.path(),
                        &folder_name,
                        display_override,
                        resolved_type,
                    )? {
                        series_list.push(s);
                    }
                } else {
                    // Nested structure: each subdirectory is a separate series
                    for nested in WalkDir::new(sub_entry.path())
                        .min_depth(1)
                        .max_depth(1)
                        .sort_by_file_name()
                        .into_iter()
                        .filter_map(|e| e.ok())
                    {
                        if !nested.file_type().is_dir() {
                            continue;
                        }
                        let nested_name = nested
                            .file_name()
                            .to_str()
                            .unwrap_or("")
                            .to_string();
                        if nested_name.starts_with('.') {
                            continue;
                        }

                        let (nested_type, nested_display) =
                            resolve_type_hint(nested.path(), &nested_name, Some(&hint));
                        let effective_type = nested_type.or(resolved_type.clone());

                        if let Some(s) = build_series_scan(
                            nested.path(),
                            &nested_name,
                            nested_display,
                            effective_type,
                        )? {
                            series_list.push(s);
                        }
                    }
                }
            }
        } else {
            // Legacy: depth-1 folder is directly a series
            let folder_name = entry_name.to_string();
            if folder_name.starts_with('.') {
                continue;
            }

            // Root-level type override: if the user assigned a type to this root directory,
            // use it as the default parent hint for series not in type-hint containers.
            let root_parent_hint = root_type
                .filter(|t| *t != "auto" && !t.is_empty());

            // Multi-source type-hint resolution
            let (resolved_type, display_override) =
                resolve_type_hint(entry.path(), &folder_name, root_parent_hint);

            if has_video_at_depth1(entry.path()) {
                // Flat series: scan the folder directly
                if let Some(s) = build_series_scan(
                    entry.path(),
                    &folder_name,
                    display_override,
                    resolved_type,
                )? {
                    series_list.push(s);
                }
            } else {
                // Nested structure: each subdirectory is a separate series
                for nested in WalkDir::new(entry.path())
                    .min_depth(1)
                    .max_depth(1)
                    .sort_by_file_name()
                    .into_iter()
                    .filter_map(|e| e.ok())
                {
                    if !nested.file_type().is_dir() {
                        continue;
                    }
                    let nested_name = nested
                        .file_name()
                        .to_str()
                        .unwrap_or("")
                        .to_string();
                    if nested_name.starts_with('.') {
                        continue;
                    }

                    let (nested_type, nested_display) =
                        resolve_type_hint(nested.path(), &nested_name, root_parent_hint);
                    let effective_type = nested_type.or(resolved_type.clone());

                    if let Some(s) = build_series_scan(
                        nested.path(),
                        &nested_name,
                        nested_display,
                        effective_type,
                    )? {
                        series_list.push(s);
                    }
                }
            }
        }
    }

    // ── Flat file clustering ───────────────────────────────────────────
    if !flat_video_files.is_empty() {
        let flat_series = cluster_flat_files(root, &flat_video_files)?;
        series_list.extend(flat_series);
    }

    // Separate ambiguous series (no type-hint resolved)
    let ambiguous: Vec<SeriesScan> = series_list
        .iter()
        .filter(|s| s.series_type_hint.is_none())
        .cloned()
        .collect();

    Ok(ScanResult {
        series: series_list,
        ambiguous,
    })
}

/// Cluster flat video files by filename prefix into virtual series.
///
/// Algorithm:
/// 1. For each file, extract series prefix by stripping episode markers
/// 2. Group files with the same prefix
/// 3. Generate a SeriesScan for each group
fn cluster_flat_files(
    root: &Path,
    video_files: &[PathBuf],
) -> Result<Vec<SeriesScan>, String> {
    use std::collections::BTreeMap;

    // Extract prefix for each file
    let mut prefix_groups: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();

    for file_path in video_files {
        let file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        let prefix = extract_series_prefix(file_name);
        prefix_groups.entry(prefix).or_default().push(file_path.clone());
    }

    // Build SeriesScan for each group
    let mut series_list: Vec<SeriesScan> = Vec::new();

    for (prefix, files) in prefix_groups {
        if prefix.is_empty() || files.is_empty() {
            continue;
        }

        let folder_name = prefix.clone();

        // Extract season from prefix (e.g. "哈哈哈哈哈 第六季 EP01" → "哈哈哈哈哈", 6)
        let (prefix_clean, flat_season) = extract_season_from_name(&prefix);

        // Build episodes from the clustered files
        let mut episodes: Vec<EpisodeScan> = Vec::new();

        // C1: Classify
        let mut matched: Vec<(PathBuf, i32, i32, bool)> = Vec::new();
        let mut fallback: Vec<PathBuf> = Vec::new();

        for file_path in &files {
            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            if is_excluded(file_name) {
                continue;
            }

            if let Some((season, episode, explicit)) = extract_episode_info(file_name) {
                matched.push((file_path.clone(), season, episode, explicit));
            } else {
                fallback.push(file_path.clone());
            }
        }

        // Process matched
        let mut occupied: HashSet<i32> = HashSet::new();
        for (file_path, season_number, episode_number, season_explicit) in &matched {
            let effective_season = if !season_explicit {
                flat_season.unwrap_or(*season_number)
            } else {
                *season_number
            };
            occupied.insert(*episode_number);
            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let abs_path = normalize_path(file_path);
            episodes.push(EpisodeScan {
                file_path: abs_path,
                file_name,
                episode_number: *episode_number,
                season_number: effective_season,
                title: None,
                subtitle_count: 0,
                subtitle_paths: Vec::new(),
                status: "ready".to_string(),
                match_method: "regex".to_string(),
            });
        }

        // C2: Fallback
        let mut next_ep = 1i32;
        for file_path in &fallback {
            while occupied.contains(&next_ep) {
                next_ep += 1;
            }
            let assigned_ep = next_ep;
            occupied.insert(assigned_ep);
            next_ep += 1;

            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let abs_path = normalize_path(file_path);

            let fallback_season = flat_season.unwrap_or(1);

            episodes.push(EpisodeScan {
                file_path: abs_path,
                file_name,
                episode_number: assigned_ep,
                season_number: fallback_season,
                title: None,
                subtitle_count: 0,
                subtitle_paths: Vec::new(),
                status: "ready".to_string(),
                match_method: "fallback".to_string(),
            });
        }

        // Sort episodes
        episodes.sort_by(|a, b| {
            a.season_number
                .cmp(&b.season_number)
                .then(a.episode_number.cmp(&b.episode_number))
        });

        // Resolve type-hint (no folder, so check .mochi/flat and folder name suffix)
        let (resolved_type, display_override) = {
            // For flat files, check .mochi/{prefix}.mochi
            if let Ok(mochi) = mochi_file::read_mochi_flat(root, &prefix) {
                if let Some(t) = mochi.series_type {
                    (Some(t), None)
                } else {
                    // Check suffix on prefix
                    let (display, suffix_hint) = parse_folder_suffix(&prefix);
                    let display_ov = if display != prefix { Some(display) } else { None };
                    (suffix_hint, display_ov)
                }
            } else {
                let (display, suffix_hint) = parse_folder_suffix(&prefix);
                let display_ov = if display != prefix { Some(display) } else { None };
                (suffix_hint, display_ov)
            }
        };

        let base_display = display_override.unwrap_or_else(|| prefix_clean.clone());
        let cleaned = clean_anime_folder_name(&base_display);
        let (display_name, search_term) = parse_folder_name(&cleaned);

        series_list.push(SeriesScan {
            folder_name,
            display_name,
            search_term,
            poster_path: None,
            fanart_path: None,
            series_type_hint: resolved_type,
            episodes,
            folder_path: String::new(), // flat mode: no real folder, use .mochi/
            fonts_dir: None,             // flat mode: no series folder, no fonts/
        });
    }

    Ok(series_list)
}

/// Extract the series prefix from a filename by stripping episode markers.
///
/// Tries all regex patterns in priority order. Returns the text before the
/// first match, trimmed. If no pattern matches or the match starts at position
/// 0 (e.g. "第01集.mkv"), returns the full stem without extension.
fn extract_series_prefix(filename: &str) -> String {
    // Strip extension first
    let stem = match filename.rfind('.') {
        Some(pos) => &filename[..pos],
        None => filename,
    };

    // Try each pattern, find the earliest match position
    let mut earliest_pos: Option<usize> = None;
    for (re, _) in ep_patterns().iter() {
        if let Some(m) = re.find(stem) {
            let pos = m.start();
            if earliest_pos.map_or(true, |ep| pos < ep) {
                earliest_pos = Some(pos);
            }
        }
    }

    match earliest_pos {
        Some(0) | None => stem.trim().to_string(),
        Some(pos) => stem[..pos].trim().to_string(),
    }
}
pub(crate) fn scan_series_folder(
    dir: &Path,
    default_season: Option<i32>,
) -> Result<(Vec<EpisodeScan>, Option<String>, Option<String>), String> {
    // Collect all files in this folder (depth 1 only for files; also check sub/ dir)
    let mut video_files: Vec<PathBuf> = Vec::new();
    let mut subtitle_files: Vec<PathBuf> = Vec::new();
    let mut temp_files: Vec<PathBuf> = Vec::new();
    let mut poster_path: Option<String> = None;
    let mut fanart_path: Option<String> = None;

    // Also collect files from sub/ subs/ directories
    let mut sub_dir_files: Vec<PathBuf> = Vec::new();

    for entry in WalkDir::new(dir)
        .min_depth(1)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let depth = entry.depth();

        // Check for cover materials (depth 1 only)
        if depth == 1 {
            if let Some(lower_name) = filename_lower(path) {
                if POSTER_NAMES.contains(&lower_name.as_str()) {
                    poster_path = Some(path.to_string_lossy().to_string());
                    continue;
                }
                if FANART_NAMES.contains(&lower_name.as_str()) {
                    fanart_path = Some(path.to_string_lossy().to_string());
                    continue;
                }
            }
        }

        let ext = match ext_lower(path) {
            Some(e) => e,
            None => continue,
        };

        if VIDEO_EXTS.contains(&ext.as_str()) {
            if depth == 1 {
                video_files.push(path.to_path_buf());
            }
        } else if SUB_EXTS.contains(&ext.as_str()) {
            if depth == 1 {
                subtitle_files.push(path.to_path_buf());
            } else if depth == 2 {
                // Subtitle file in sub/ or subs/ directory
                let parent_name = path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .map(|n| n.to_lowercase())
                    .unwrap_or_default();
                if parent_name == "sub" || parent_name == "subs" {
                    sub_dir_files.push(path.to_path_buf());
                }
            }
        } else if TEMP_EXTS.contains(&ext.as_str()) {
            if depth == 1 {
                temp_files.push(path.to_path_buf());
            }
        }
    }

    // ── Season sub-directory scanning ────────────────────────────────
    // Detect depth-1 sub-directories whose names contain season hints
    // (e.g. "东京食尸鬼S01", "Season 2", "第1季"). Collect their video
    // files into the same pipeline, keyed by parent season.
    let mut parent_season_map: HashMap<PathBuf, i32> = HashMap::new();

    for entry in WalkDir::new(dir)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_dir() {
            continue;
        }
        let subdir_name = entry.file_name().to_str().unwrap_or("");
        if subdir_name.starts_with('.') {
            continue;
        }

        // Try to extract season number from sub-directory name
        if let (_, Some(season)) = extract_season_from_name(subdir_name) {
            let subdir = entry.path();

            // Collect video, subtitle, and temp files from season sub-directory
            for file_entry in WalkDir::new(subdir)
                .min_depth(1)
                .max_depth(1)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let file_path = file_entry.path();
                if !file_path.is_file() {
                    continue;
                }

                let ext = match ext_lower(file_path) {
                    Some(e) => e,
                    None => continue,
                };

                if VIDEO_EXTS.contains(&ext.as_str()) {
                    let file_name = file_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("");
                    if !is_excluded(file_name) {
                        parent_season_map.insert(file_path.to_path_buf(), season);
                        video_files.push(file_path.to_path_buf());
                    }
                } else if SUB_EXTS.contains(&ext.as_str()) {
                    subtitle_files.push(file_path.to_path_buf());
                } else if TEMP_EXTS.contains(&ext.as_str()) {
                    temp_files.push(file_path.to_path_buf());
                }
            }

            // Also collect subtitles from season sub-directory's sub/ or subs/
            for sub_entry in WalkDir::new(subdir)
                .min_depth(2)
                .max_depth(2)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let sub_path = sub_entry.path();
                if !sub_path.is_file() {
                    continue;
                }
                if let Some(ext) = ext_lower(sub_path) {
                    if SUB_EXTS.contains(&ext.as_str()) {
                        let parent_name = sub_path
                            .parent()
                            .and_then(|p| p.file_name())
                            .and_then(|n| n.to_str())
                            .map(|n| n.to_lowercase())
                            .unwrap_or_default();
                        if parent_name == "sub" || parent_name == "subs" {
                            sub_dir_files.push(sub_path.to_path_buf());
                        }
                    }
                }
            }
        }
    }

    // Build episode list: C1 (regex match) then C2 (fallback assignment)
    let mut episodes: Vec<EpisodeScan> = Vec::new();
    let mut matched: Vec<(PathBuf, i32, i32, bool)> = Vec::new(); // (path, season, episode, season_explicit)
    let mut fallback: Vec<PathBuf> = Vec::new();

    // Build a set of "downloading" video stems
    let downloading_stems: HashSet<String> = temp_files
        .iter()
        .filter_map(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_lowercase())
        })
        .collect();

    // ── C1: Classify video files ──────────────────────────────────────
    for video_path in &video_files {
        let file_name = video_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Exclusion check
        if is_excluded(&file_name) {
            continue;
        }

        // Try regex match
        if let Some((season, episode, explicit)) = extract_episode_info(&file_name) {
            matched.push((video_path.clone(), season, episode, explicit));
        } else {
            fallback.push(video_path.clone());
        }
    }

    // ── Process matched files, track occupied episode numbers ─────────
    let mut occupied: HashSet<i32> = HashSet::new();

    for (video_path, season_number, episode_number, season_explicit) in &matched {
        // Season priority: filename SXXEXX > parent sub-directory > folder default
        let effective_season = if *season_explicit {
            *season_number
        } else if let Some(ps) = parent_season_map.get(video_path) {
            *ps
        } else {
            default_season.unwrap_or(*season_number)
        };
        occupied.insert(*episode_number);

        let file_name = video_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let stem_lower = video_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();

        let status = if downloading_stems.contains(&stem_lower) {
            "downloading".to_string()
        } else {
            "ready".to_string()
        };

        let (subtitle_count, subtitle_paths) = count_subtitles(
            &subtitle_files, &sub_dir_files, &stem_lower, *episode_number);

        let abs_path = normalize_path(video_path);

        episodes.push(EpisodeScan {
            file_path: abs_path,
            file_name,
            episode_number: *episode_number,
            season_number: effective_season,
            title: None,
            subtitle_count,
            subtitle_paths,
            status,
            match_method: "regex".to_string(),
        });
    }

    // ── C2: Fallback assignment ───────────────────────────────────────
    // Sort fallback files by natural name order
    fallback.sort_by(|a, b| {
        a.file_name()
            .and_then(|n| n.to_str())
            .cmp(&b.file_name().and_then(|n| n.to_str()))
    });

    let mut next_ep = 1i32;
    for video_path in &fallback {
        // Find next available episode number (skip occupied)
        while occupied.contains(&next_ep) {
            next_ep += 1;
        }
        let assigned_ep = next_ep;
        occupied.insert(assigned_ep);
        next_ep += 1;

        let file_name = video_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let stem_lower = video_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();

        let status = if downloading_stems.contains(&stem_lower) {
            "downloading".to_string()
        } else {
            "ready".to_string()
        };

        let (subtitle_count, subtitle_paths) = count_subtitles(
            &subtitle_files, &sub_dir_files, &stem_lower, assigned_ep);

        let abs_path = normalize_path(video_path);

        // Season priority for fallback: parent sub-directory > folder default
        let fallback_season = parent_season_map
            .get(video_path)
            .copied()
            .or(default_season)
            .unwrap_or(1);

        episodes.push(EpisodeScan {
            file_path: abs_path,
            file_name,
            episode_number: assigned_ep,
            season_number: fallback_season,
            title: None,
            subtitle_count,
            subtitle_paths,
            status,
            match_method: "fallback".to_string(),
        });
    }

    // Sort episodes by season, then episode number
    episodes.sort_by(|a, b| {
        a.season_number
            .cmp(&b.season_number)
            .then(a.episode_number.cmp(&b.episode_number))
    });

    Ok((episodes, poster_path, fanart_path))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_folder_name_with_underscore() {
        let (d, s) = parse_folder_name("黄泉使者_Yomi no Tsugai");
        assert_eq!(d, "黄泉使者");
        assert_eq!(s, "Yomi no Tsugai");
    }

    #[test]
    fn test_parse_folder_name_without_underscore() {
        let (d, s) = parse_folder_name("太阳星辰");
        assert_eq!(d, "太阳星辰");
        assert_eq!(s, "太阳星辰");
    }

    #[test]
    fn test_parse_folder_suffix_tv() {
        let (display, hint) = parse_folder_suffix("黄泉使者 [tv]");
        assert_eq!(display, "黄泉使者");
        assert_eq!(hint, Some("tv".to_string()));
    }

    #[test]
    fn test_parse_folder_suffix_anime() {
        let (display, hint) = parse_folder_suffix("上伊那牡丹 [anime]");
        assert_eq!(display, "上伊那牡丹");
        assert_eq!(hint, Some("anime".to_string()));
    }

    #[test]
    fn test_parse_folder_suffix_no_suffix() {
        let (display, hint) = parse_folder_suffix("太阳星辰");
        assert_eq!(display, "太阳星辰");
        assert_eq!(hint, None);
    }

    #[test]
    fn test_parse_folder_suffix_brackets_in_name() {
        // Only [type] at the end should match, not brackets in the middle
        let (display, hint) = parse_folder_suffix("Show [1080p] [tv]");
        assert_eq!(display, "Show [1080p]");
        assert_eq!(hint, Some("tv".to_string()));
    }

    #[test]
    fn test_parse_folder_name_multiple_underscores() {
        let (d, s) = parse_folder_name("foo_bar_baz");
        assert_eq!(d, "foo_bar");
        assert_eq!(s, "baz");
    }

    #[test]
    fn test_extract_episode_e_pattern() {
        assert_eq!(extract_episode_info("太阳星辰_E01_粤语.ts"), Some((1, 1, false)));
        assert_eq!(extract_episode_info("Show_E24.mkv"), Some((1, 24, false)));
    }

    #[test]
    fn test_extract_episode_chinese_pattern() {
        assert_eq!(
            extract_episode_info("上伊那牡丹 - 第01集.mkv"),
            Some((1, 1, false))
        );
        assert_eq!(extract_episode_info("第12集.mkv"), Some((1, 12, false)));
    }

    #[test]
    fn test_extract_episode_se_pattern() {
        assert_eq!(
            extract_episode_info("Show S01E12.mkv"),
            Some((1, 12, true))
        );
        assert_eq!(
            extract_episode_info("s02e03.mkv"),
            Some((2, 3, true))
        );
    }

    #[test]
    fn test_extract_episode_dash_pattern() {
        assert_eq!(
            extract_episode_info("Yomi no Tsugai - 03 [1080p HEVC].mkv"),
            Some((1, 3, false))
        );
    }

    // ── New patterns (Phase 2 expansion) ──────────────────────────────

    #[test]
    fn test_extract_episode_bracket_pattern() {
        // Priority 5: [XX]
        assert_eq!(
            extract_episode_info("[VCB-Studio] Kamiina Botan [01].mkv"),
            Some((1, 1, false))
        );
        assert_eq!(extract_episode_info("[12].mkv"), Some((1, 12, false)));
        // Should not match [VCB-Studio] (non-digit content)
        assert!(extract_episode_info("[VCB-Studio] Show.mkv").is_none());
    }

    #[test]
    fn test_extract_episode_ep_pattern() {
        // Priority 6: EPXX
        assert_eq!(extract_episode_info("Show EP01.mkv"), Some((1, 1, false)));
        assert_eq!(extract_episode_info("ep24.mkv"), Some((1, 24, false)));
    }

    #[test]
    fn test_extract_episode_hash_pattern() {
        // Priority 7: #XX
        assert_eq!(extract_episode_info("Show #01.mkv"), Some((1, 1, false)));
        assert_eq!(extract_episode_info("series #12 [1080p].mkv"), Some((1, 12, false)));
    }

    #[test]
    fn test_extract_episode_jp_wa_pattern() {
        // Priority 8: 第XX話
        assert_eq!(extract_episode_info("第1話.mkv"), Some((1, 1, false)));
        assert_eq!(extract_episode_info("姫様「拷問」の時間です 第12話.mkv"), Some((1, 12, false)));
    }

    #[test]
    fn test_extract_episode_no_match() {
        assert_eq!(extract_episode_info("trailer.mkv"), None);
        assert_eq!(extract_episode_info("README.txt"), None);
    }

    // ── Exclusion tests ────────────────────────────────────────────────

    #[test]
    fn test_is_excluded_ncop() {
        assert!(is_excluded("[VCB-Studio] Show NCOP.mkv"));
        assert!(is_excluded("ncop.mkv"));
    }

    #[test]
    fn test_is_excluded_nced() {
        assert!(is_excluded("Show_NCED.mkv"));
    }

    #[test]
    fn test_is_excluded_sp() {
        assert!(is_excluded("Show_SP01.mkv"));
        assert!(is_excluded("SP.mkv"));
    }

    #[test]
    fn test_is_excluded_trailer_preview_menu() {
        assert!(is_excluded("trailer.mp4"));
        assert!(is_excluded("Preview.mp4"));
        assert!(is_excluded("menu.mkv"));
    }

    #[test]
    fn test_is_excluded_creditless() {
        assert!(is_excluded("[VCB-Studio] Show Creditless ED.mkv"));
    }

    #[test]
    fn test_is_excluded_normal_file() {
        assert!(!is_excluded("Show_E01.mkv"));
        assert!(!is_excluded("第01集.mkv"));
        assert!(!is_excluded("normal episode.mkv"));
    }

    // ── Priority order tests ───────────────────────────────────────────

    #[test]
    fn test_pattern_priority_e_before_ep() {
        // _E01 should be caught by pattern 1, not pattern 6
        assert_eq!(
            extract_episode_info("Show_E01.mkv"),
            Some((1, 1, false))
        );
    }

    #[test]
    fn test_pattern_priority_se_before_bracket() {
        // S01E12 should be caught by pattern 3, not pattern 5
        assert_eq!(
            extract_episode_info("Show S01E12 [01].mkv"),
            Some((1, 12, true))
        );
    }

    #[test]
    fn test_pattern_priority_dash_before_bracket() {
        // - 03 should be caught by pattern 4 before [01] by pattern 5
        // But actually the regex for pattern 4 requires whitespace-dash-whitespace-digit
        // So for "Show - 03 [01].mkv", pattern 4 matches first (episode 3)
        assert_eq!(
            extract_episode_info("Show - 03 [01].mkv"),
            Some((1, 3, false))
        );
    }

    // ── Prefix extraction tests ───────────────────────────────────────

    #[test]
    fn test_extract_prefix_e_pattern() {
        assert_eq!(extract_series_prefix("黄泉使者_E01.mkv"), "黄泉使者");
        assert_eq!(extract_series_prefix("太阳星辰_E01_粤语.ts"), "太阳星辰");
    }

    #[test]
    fn test_extract_prefix_chinese_pattern() {
        // Full stem returned when match is at position 0
        assert_eq!(extract_series_prefix("第01集.mkv"), "第01集");
    }

    #[test]
    fn test_extract_prefix_se_pattern() {
        assert_eq!(extract_series_prefix("Show S01E12.mkv"), "Show");
    }

    #[test]
    fn test_extract_prefix_bracket_pattern() {
        assert_eq!(
            extract_series_prefix("[VCB-Studio] Kamiina Botan [01].mkv"),
            "[VCB-Studio] Kamiina Botan"
        );
    }

    #[test]
    fn test_extract_prefix_dash_pattern() {
        assert_eq!(
            extract_series_prefix("Yomi no Tsugai - 03 [1080p HEVC].mkv"),
            "Yomi no Tsugai"
        );
    }

    #[test]
    fn test_extract_prefix_ep_pattern() {
        assert_eq!(extract_series_prefix("Show EP01.mkv"), "Show");
    }

    #[test]
    fn test_extract_prefix_hash_pattern() {
        assert_eq!(extract_series_prefix("Show #01.mkv"), "Show");
    }

    #[test]
    fn test_extract_prefix_no_match() {
        // No episode pattern matched: return full stem
        assert_eq!(extract_series_prefix("trailer.mkv"), "trailer");
        assert_eq!(extract_series_prefix("random_video.mp4"), "random_video");
    }
}
