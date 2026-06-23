use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
            // 1. _EXX  →  episode only
            (Regex::new(r"_E(\d{1,3})").unwrap(), false),
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

/// Count subtitle files matching a given video stem and collect their paths.
fn count_subtitles(
    root_subs: &[PathBuf],
    sub_dir_files: &[PathBuf],
    video_stem_lower: &str,
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
    let count = (matched_root.len() + matched_sub.len()) as i32;
    let mut paths = matched_root;
    paths.extend(matched_sub);
    (count, paths)
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
/// Returns (season_number, episode_number) or None if no pattern matched.
fn extract_episode_info(filename: &str) -> Option<(i32, i32)> {
    for (re, has_season) in ep_patterns().iter() {
        if let Some(caps) = re.captures(filename) {
            if *has_season {
                // SXXEYY pattern
                let s: i32 = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(1);
                let e: i32 = caps.get(2).and_then(|m| m.as_str().parse().ok())?;
                return Some((s, e));
            } else {
                let e: i32 = caps.get(1).and_then(|m| m.as_str().parse().ok())?;
                return Some((1, e));
            }
        }
    }
    None
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

                // Determine display_name and search_term
                let base_display = display_override.unwrap_or_else(|| folder_name.clone());
                let (display_name, search_term) = parse_folder_name(&base_display);

                let (episodes, poster_path, fanart_path) =
                    scan_series_folder(sub_entry.path())?;
                series_list.push(SeriesScan {
                    folder_name,
                    display_name,
                    search_term,
                    poster_path,
                    fanart_path,
                    series_type_hint: resolved_type,
                    episodes,
                    folder_path: sub_entry.path().to_string_lossy().to_string(),
                });
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

            let base_display = display_override.unwrap_or_else(|| folder_name.clone());
            let (display_name, search_term) = parse_folder_name(&base_display);

            let (episodes, poster_path, fanart_path) =
                scan_series_folder(entry.path())?;
            series_list.push(SeriesScan {
                folder_name,
                display_name,
                search_term,
                poster_path,
                fanart_path,
                series_type_hint: resolved_type,
                episodes,
                folder_path: entry.path().to_string_lossy().to_string(),
            });
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

        // Build episodes from the clustered files
        let mut episodes: Vec<EpisodeScan> = Vec::new();

        // C1: Classify
        let mut matched: Vec<(PathBuf, i32, i32)> = Vec::new();
        let mut fallback: Vec<PathBuf> = Vec::new();

        for file_path in &files {
            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            if is_excluded(file_name) {
                continue;
            }

            if let Some((season, episode)) = extract_episode_info(file_name) {
                matched.push((file_path.clone(), season, episode));
            } else {
                fallback.push(file_path.clone());
            }
        }

        // Process matched
        let mut occupied: HashSet<i32> = HashSet::new();
        for (file_path, season_number, episode_number) in &matched {
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
                season_number: *season_number,
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
            episodes.push(EpisodeScan {
                file_path: abs_path,
                file_name,
                episode_number: assigned_ep,
                season_number: 1,
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

        let base_display = display_override.unwrap_or_else(|| prefix.clone());
        let (display_name, search_term) = parse_folder_name(&base_display);

        series_list.push(SeriesScan {
            folder_name,
            display_name,
            search_term,
            poster_path: None,
            fanart_path: None,
            series_type_hint: resolved_type,
            episodes,
            folder_path: String::new(), // flat mode: no real folder, use .mochi/
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
fn scan_series_folder(
    dir: &Path,
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

    // Build episode list: C1 (regex match) then C2 (fallback assignment)
    let mut episodes: Vec<EpisodeScan> = Vec::new();
    let mut matched: Vec<(PathBuf, i32, i32)> = Vec::new(); // (path, season, episode)
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
        if let Some((season, episode)) = extract_episode_info(&file_name) {
            matched.push((video_path.clone(), season, episode));
        } else {
            fallback.push(video_path.clone());
        }
    }

    // ── Process matched files, track occupied episode numbers ─────────
    let mut occupied: HashSet<i32> = HashSet::new();

    for (video_path, season_number, episode_number) in &matched {
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
            &subtitle_files, &sub_dir_files, &stem_lower);

        let abs_path = normalize_path(video_path);

        episodes.push(EpisodeScan {
            file_path: abs_path,
            file_name,
            episode_number: *episode_number,
            season_number: *season_number,
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
            &subtitle_files, &sub_dir_files, &stem_lower);

        let abs_path = normalize_path(video_path);

        episodes.push(EpisodeScan {
            file_path: abs_path,
            file_name,
            episode_number: assigned_ep,
            season_number: 1,
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
        assert_eq!(extract_episode_info("太阳星辰_E01_粤语.ts"), Some((1, 1)));
        assert_eq!(extract_episode_info("Show_E24.mkv"), Some((1, 24)));
    }

    #[test]
    fn test_extract_episode_chinese_pattern() {
        assert_eq!(
            extract_episode_info("上伊那牡丹 - 第01集.mkv"),
            Some((1, 1))
        );
        assert_eq!(extract_episode_info("第12集.mkv"), Some((1, 12)));
    }

    #[test]
    fn test_extract_episode_se_pattern() {
        assert_eq!(
            extract_episode_info("Show S01E12.mkv"),
            Some((1, 12))
        );
        assert_eq!(
            extract_episode_info("s02e03.mkv"),
            Some((2, 3))
        );
    }

    #[test]
    fn test_extract_episode_dash_pattern() {
        assert_eq!(
            extract_episode_info("Yomi no Tsugai - 03 [1080p HEVC].mkv"),
            Some((1, 3))
        );
    }

    // ── New patterns (Phase 2 expansion) ──────────────────────────────

    #[test]
    fn test_extract_episode_bracket_pattern() {
        // Priority 5: [XX]
        assert_eq!(
            extract_episode_info("[VCB-Studio] Kamiina Botan [01].mkv"),
            Some((1, 1))
        );
        assert_eq!(extract_episode_info("[12].mkv"), Some((1, 12)));
        // Should not match [VCB-Studio] (non-digit content)
        assert!(extract_episode_info("[VCB-Studio] Show.mkv").is_none());
    }

    #[test]
    fn test_extract_episode_ep_pattern() {
        // Priority 6: EPXX
        assert_eq!(extract_episode_info("Show EP01.mkv"), Some((1, 1)));
        assert_eq!(extract_episode_info("ep24.mkv"), Some((1, 24)));
    }

    #[test]
    fn test_extract_episode_hash_pattern() {
        // Priority 7: #XX
        assert_eq!(extract_episode_info("Show #01.mkv"), Some((1, 1)));
        assert_eq!(extract_episode_info("series #12 [1080p].mkv"), Some((1, 12)));
    }

    #[test]
    fn test_extract_episode_jp_wa_pattern() {
        // Priority 8: 第XX話
        assert_eq!(extract_episode_info("第1話.mkv"), Some((1, 1)));
        assert_eq!(extract_episode_info("姫様「拷問」の時間です 第12話.mkv"), Some((1, 12)));
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
            Some((1, 1))
        );
    }

    #[test]
    fn test_pattern_priority_se_before_bracket() {
        // S01E12 should be caught by pattern 3, not pattern 5
        assert_eq!(
            extract_episode_info("Show S01E12 [01].mkv"),
            Some((1, 12))
        );
    }

    #[test]
    fn test_pattern_priority_dash_before_bracket() {
        // - 03 should be caught by pattern 4 before [01] by pattern 5
        // But actually the regex for pattern 4 requires whitespace-dash-whitespace-digit
        // So for "Show - 03 [01].mkv", pattern 4 matches first (episode 3)
        assert_eq!(
            extract_episode_info("Show - 03 [01].mkv"),
            Some((1, 3))
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
