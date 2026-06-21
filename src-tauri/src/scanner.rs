use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use walkdir::WalkDir;

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
        ]
    });
    &PATTERNS
}

// ── Output types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub series: Vec<SeriesScan>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeScan {
    pub file_path: String,
    pub file_name: String,
    pub episode_number: i32,
    pub season_number: i32,
    pub title: Option<String>,
    pub subtitle_count: i32,
    pub status: String, // "ready" | "downloading"
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

/// Check if a path has a stem matching the given video stem (for subtitle/temp association).
#[allow(dead_code)]
fn has_same_stem(file_path: &Path, video_stem: &str) -> bool {
    file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase() == video_stem.to_lowercase())
        .unwrap_or(false)
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
///   上伊那牡丹_Kamiina Botan\        ← no hint → type=unknown
/// ```
pub fn scan_library(root_path: &str) -> Result<ScanResult, String> {
    let root = Path::new(root_path);
    if !root.is_dir() {
        return Err(format!("Root path is not a directory: {}", root_path));
    }

    const TYPE_HINTS: &[(&str, &str)] = &[
        ("anime", "anime"),
        ("tv", "tv"),
        ("movie", "movie"),
        ("teleplay", "tv"),
    ];

    let mut series_list: Vec<SeriesScan> = Vec::new();

    // Iterate depth-1 entries
    for entry in WalkDir::new(root)
        .min_depth(1)
        .max_depth(1)
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
    {
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
                let (display_name, search_term) = parse_folder_name(&folder_name);
                let (episodes, poster_path, fanart_path) =
                    scan_series_folder(sub_entry.path())?;
                series_list.push(SeriesScan {
                    folder_name,
                    display_name,
                    search_term,
                    poster_path,
                    fanart_path,
                    series_type_hint: Some(hint.clone()),
                    episodes,
                });
            }
        } else {
            // Legacy: depth-1 folder is directly a series
            let folder_name = entry_name.to_string();
            if folder_name.starts_with('.') {
                continue;
            }
            let (display_name, search_term) = parse_folder_name(&folder_name);
            let (episodes, poster_path, fanart_path) =
                scan_series_folder(entry.path())?;
            series_list.push(SeriesScan {
                folder_name,
                display_name,
                search_term,
                poster_path,
                fanart_path,
                series_type_hint: None,
                episodes,
            });
        }
    }

    Ok(ScanResult {
        series: series_list,
    })
}

/// Scan a single series folder. Returns episodes, poster path, fanart path.
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

    // Build episode list
    let mut episodes: Vec<EpisodeScan> = Vec::new();

    // Build a set of "downloading" video stems
    let downloading_stems: HashSet<String> = temp_files
        .iter()
        .filter_map(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_lowercase())
        })
        .collect();

    for video_path in &video_files {
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

        // Extract episode info
        let (season_number, episode_number) = match extract_episode_info(&file_name) {
            Some(info) => info,
            None => continue, // skip files that don't match any pattern
        };

        // Determine status
        let status = if downloading_stems.contains(&stem_lower) {
            "downloading".to_string()
        } else {
            "ready".to_string()
        };

        // Count subtitle files matching this video
        let subtitle_count: i32 = subtitle_files
            .iter()
            .filter(|sub| {
                sub.file_stem()
                    .and_then(|s| s.to_str())
                    .map(|sub_stem| {
                        let sub_stem_lower = sub_stem.to_lowercase();
                        sub_stem_lower == stem_lower
                            || sub_stem_lower.starts_with(&format!("{}.", stem_lower))
                            || sub_stem_lower.starts_with(&format!("{}_", stem_lower))
                    })
                    .unwrap_or(false)
            })
            .count() as i32
            + sub_dir_files
                .iter()
                .filter(|sub| {
                    sub.file_stem()
                        .and_then(|s| s.to_str())
                        .map(|sub_stem| {
                            let sub_stem_lower = sub_stem.to_lowercase();
                            sub_stem_lower == stem_lower
                                || sub_stem_lower.starts_with(&format!("{}.", stem_lower))
                                || sub_stem_lower.starts_with(&format!("{}_", stem_lower))
                        })
                        .unwrap_or(false)
                })
                .count() as i32;

        let title = None;

        let abs_path = video_path
            .canonicalize()
            .unwrap_or_else(|_| video_path.clone());
        // Normalize: strip \\?\ prefix and forward slashes for mpv compat
        let abs_path = abs_path.to_string_lossy().to_string();
        let abs_path = abs_path.strip_prefix("\\\\?\\").unwrap_or(&abs_path);
        let abs_path = abs_path.replace('\\', "/");

        episodes.push(EpisodeScan {
            file_path: abs_path,
            file_name,
            episode_number,
            season_number,
            title,
            subtitle_count,
            status,
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

    #[test]
    fn test_extract_episode_no_match() {
        assert_eq!(extract_episode_info("trailer.mkv"), None);
        assert_eq!(extract_episode_info("README.txt"), None);
    }


}
