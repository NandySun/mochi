//! Kodi NFO file parser and writer.
//!
//! Reads `tvshow.nfo` or `movie.nfo` from a series/movie folder and extracts
//! descriptive metadata (plot, year, genres). Technical `<fileinfo>` blocks
//! and `<actor>` entries are ignored.
//!
//! This is a passive compatibility feature: if no .nfo file exists, nothing
//! happens. Parsing errors are silently swallowed to avoid disrupting scans
//! for users who don't have NFO files.

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use std::path::Path;

/// Parsed descriptive metadata from a Kodi NFO file.
#[derive(Debug, Clone, Default)]
pub struct NfoData {
    pub synopsis: Option<String>,
    pub year: Option<i32>,
    /// JSON array of genre strings, e.g. `["动画","奇幻"]`
    pub genres: Option<String>,
}

/// Filenames to check (case-insensitive on Windows, but we match exactly).
const NFO_NAMES: &[&str] = &["tvshow.nfo", "movie.nfo"];

/// File extensions to consider for sidecar images (Kodi convention).
const SIDECAR_EXTS: &[&str] = &["jpg", "png"];

/// Try to read and parse an NFO file from the given directory.
/// Returns `None` if no recognized NFO file exists or parsing fails.
pub fn read_nfo(dir_path: &Path) -> Option<NfoData> {
    for name in NFO_NAMES {
        let nfo_path = dir_path.join(name);
        if nfo_path.is_file() {
            let content = std::fs::read_to_string(&nfo_path).ok()?;
            return parse_nfo(&content);
        }
    }
    None
}

fn parse_nfo(xml: &str) -> Option<NfoData> {
    let mut reader = Reader::from_str(xml);

    let mut data = NfoData::default();
    let mut current_tag = String::new();
    let mut genres: Vec<String> = Vec::new();
    let mut depth: i32 = 0;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                depth += 1;
                current_tag = String::from_utf8_lossy(e.name().as_ref())
                    .to_ascii_lowercase();
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default();
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match current_tag.as_str() {
                    "plot" => {
                        if data.synopsis.is_none() {
                            data.synopsis = Some(trimmed.to_string());
                        }
                    }
                    "year" => {
                        if data.year.is_none() {
                            data.year = trimmed.parse().ok();
                        }
                    }
                    "premiered" => {
                        if data.year.is_none() && trimmed.len() >= 4 {
                            data.year = trimmed[..4].parse().ok();
                        }
                    }
                    "genre" => {
                        genres.push(trimmed.to_string());
                    }
                    _ => {}
                }
            }
            Ok(Event::End(_)) => {
                depth -= 1;
                if depth == 0 {
                    break; // done with root element
                }
                current_tag.clear();
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    if !genres.is_empty() {
        data.genres = serde_json::to_string(&genres).ok();
    }

    // Return None if we got nothing useful — avoids writing empty updates
    if data.synopsis.is_none() && data.year.is_none() && data.genres.is_none() {
        return None;
    }

    Some(data)
}

// ── Write ───────────────────────────────────────────────────────────────────

/// Input data for writing a Kodi NFO file.
#[derive(Debug, Clone, Default)]
pub struct NfoWriteData {
    pub title: String,
    pub plot: Option<String>,
    pub year: Option<i32>,
    pub genres: Vec<String>,
    pub tmdb_id: Option<i64>,
    pub bangumi_id: Option<i64>,
    /// Series type: "tv" | "movie" | "anime" | "variety"
    pub series_type: String,
}

/// Outcome of an `write_nfo` call.
#[derive(Debug, Clone, Serialize)]
pub struct NfoWriteResult {
    /// Absolute path of the written (or skipped) NFO file.
    pub nfo_path: String,
    /// Sidecar image filenames copied to the folder (e.g. `["poster.jpg"]`).
    pub sidecar_written: Vec<String>,
    /// Always `false` on the Ok path; set by callers that pre-check existence.
    pub skipped_existing: bool,
}

/// Filename to write for each series type. `movie` is special-cased; everything
/// else (tv, anime, variety) becomes a `tvshow.nfo` because Kodi/Emby/Jellyfin
/// all model anime as TV shows.
fn nfo_filename_for(series_type: &str) -> &'static str {
    if series_type == "movie" {
        "movie.nfo"
    } else {
        "tvshow.nfo"
    }
}

/// Write a Kodi NFO file to the given directory.
///
/// # Conflict handling
/// If the NFO file already exists, returns `Err` with message starting with
/// "NFO already exists" unless `overwrite` is true. This honors mochi's
/// "passive compatibility" philosophy: don't clobber data the user (or
/// Emby/Jellyfin) put there.
///
/// # Sidecar images
/// If `poster_src` and/or `fanart_src` are provided AND the destination
/// folder does not already have a `poster.jpg`/`.png` or `fanart.jpg`/`.png`,
/// the images are copied to the folder. User-placed sidecars always win.
pub fn write_nfo(
    dir: &Path,
    data: &NfoWriteData,
    poster_src: Option<&Path>,
    fanart_src: Option<&Path>,
    overwrite: bool,
) -> Result<NfoWriteResult, String> {
    let nfo_name = nfo_filename_for(&data.series_type);
    let nfo_path = dir.join(nfo_name);

    if nfo_path.is_file() && !overwrite {
        return Err(format!(
            "NFO already exists at {} (set overwrite=true to replace)",
            nfo_path.display()
        ));
    }

    let xml = build_nfo_xml(data);

    // Atomic write: tmp file → rename, mirroring the .mochi write pattern.
    let tmp_path = dir.join(format!("{}.tmp", nfo_name));
    std::fs::write(&tmp_path, xml.as_bytes())
        .map_err(|e| format!("write NFO tmp failed: {e}"))?;
    std::fs::rename(&tmp_path, &nfo_path)
        .map_err(|e| format!("rename NFO failed: {e}"))?;

    let mut sidecar_written = Vec::new();
    if let Some(src) = poster_src {
        if !sidecar_exists(dir, "poster") {
            let dst = dir.join("poster.jpg");
            std::fs::copy(src, &dst)
                .map_err(|e| format!("copy poster.jpg failed: {e}"))?;
            sidecar_written.push("poster.jpg".to_string());
        }
    }
    if let Some(src) = fanart_src {
        if !sidecar_exists(dir, "fanart") {
            let dst = dir.join("fanart.jpg");
            std::fs::copy(src, &dst)
                .map_err(|e| format!("copy fanart.jpg failed: {e}"))?;
            sidecar_written.push("fanart.jpg".to_string());
        }
    }

    Ok(NfoWriteResult {
        nfo_path: nfo_path.to_string_lossy().to_string(),
        sidecar_written,
        skipped_existing: false,
    })
}

/// True if `poster.jpg`/`poster.png` (or `fanart.jpg`/`fanart.png`) already
/// exists in the folder. User-placed files always win over mochi's cache.
fn sidecar_exists(dir: &Path, base: &str) -> bool {
    dir.join(format!("{}.jpg", base)).is_file()
        || dir.join(format!("{}.png", base)).is_file()
}

/// Outcome of a `clear_nfo` call.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ClearNfoResult {
    /// Name of the deleted NFO file (e.g. `"tvshow.nfo"`), or `None` if no
    /// NFO existed in the folder.
    pub nfo_deleted: Option<String>,
    /// Names of deleted sidecar files (e.g. `["poster.jpg", "fanart.jpg"]`).
    pub sidecars_deleted: Vec<String>,
}

/// Delete the NFO file (and optionally the sidecar images) from a series folder.
///
/// # Idempotency
/// Missing files are silently skipped — calling this on a folder with no
/// NFO (and no sidecars) returns an empty result without error. This makes
/// the function safe to call from batch handlers without per-file guards.
///
/// # Sidecar caveat
/// When `include_sidecars` is `true`, the function deletes `poster.{jpg,png}`
/// and `fanart.{jpg,png}` unconditionally — mochi does not track which
/// sidecars it wrote vs. which the user placed, so user-placed files in
/// those names will also be removed. The caller is responsible for warning
/// the user about this before the batch runs.
pub fn clear_nfo(dir: &Path, include_sidecars: bool) -> Result<ClearNfoResult, String> {
    let mut result = ClearNfoResult::default();

    for name in NFO_NAMES {
        let path = dir.join(name);
        if path.is_file() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("delete {}: {e}", name))?;
            result.nfo_deleted = Some(name.to_string());
            break;
        }
    }

    if include_sidecars {
        for base in &["poster", "fanart"] {
            for ext in SIDECAR_EXTS {
                let path = dir.join(format!("{}.{}", base, ext));
                if path.is_file() {
                    std::fs::remove_file(&path)
                        .map_err(|e| format!("delete {}.{}: {e}", base, ext))?;
                    result.sidecars_deleted.push(format!("{}.{}", base, ext));
                }
            }
        }
    }

    Ok(result)
}

fn build_nfo_xml(data: &NfoWriteData) -> String {
    let root = if data.series_type == "movie" {
        "movie"
    } else {
        "tvshow"
    };
    let mut s = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    s.push_str(&format!("<{}>\n", root));
    s.push_str(&format!("  <title>{}</title>\n", xml_escape(&data.title)));
    if let Some(plot) = &data.plot {
        s.push_str(&format!("  <plot>{}</plot>\n", xml_escape(plot)));
    }
    if let Some(year) = data.year {
        s.push_str(&format!("  <year>{}</year>\n", year));
    }
    for genre in &data.genres {
        s.push_str(&format!("  <genre>{}</genre>\n", xml_escape(genre)));
    }
    if let Some(id) = data.tmdb_id {
        s.push_str(&format!("  <uniqueid type=\"tmdb\">{}</uniqueid>\n", id));
    }
    if let Some(id) = data.bangumi_id {
        s.push_str(&format!("  <uniqueid type=\"bangumi\">{}</uniqueid>\n", id));
    }
    s.push_str(&format!("</{}>\n", root));
    s
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tvshow_nfo() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<tvshow>
  <title>黄泉使者</title>
  <originaltitle>Yomi no Tsugai</originaltitle>
  <plot>冥界的使者来到人间，展开一段奇幻冒险。</plot>
  <year>2025</year>
  <premiered>2025-04-06</premiered>
  <genre>动画</genre>
  <genre>奇幻</genre>
  <genre>冒险</genre>
</tvshow>"#;

        let data = parse_nfo(xml).unwrap();
        assert_eq!(data.synopsis.as_deref(), Some("冥界的使者来到人间，展开一段奇幻冒险。"));
        assert_eq!(data.year, Some(2025));
        let genres: Vec<String> = serde_json::from_str(data.genres.as_deref().unwrap()).unwrap();
        assert_eq!(genres, vec!["动画", "奇幻", "冒险"]);
    }

    #[test]
    fn test_parse_movie_nfo() {
        let xml = r#"<?xml version="1.0"?>
<movie>
  <plot>A test movie.</plot>
  <year>2024</year>
  <genre>Action</genre>
</movie>"#;

        let data = parse_nfo(xml).unwrap();
        assert_eq!(data.synopsis.as_deref(), Some("A test movie."));
        assert_eq!(data.year, Some(2024));
    }

    #[test]
    fn test_year_from_premiered_fallback() {
        let xml = r#"<tvshow>
  <premiered>2023-07-01</premiered>
</tvshow>"#;

        let data = parse_nfo(xml).unwrap();
        assert_eq!(data.year, Some(2023));
    }

    #[test]
    fn test_empty_nfo() {
        let xml = r#"<tvshow>
  <title>Just a title</title>
</tvshow>"#;

        assert!(parse_nfo(xml).is_none());
    }

    #[test]
    fn test_malformed_xml() {
        assert!(parse_nfo("not valid xml <<<").is_none());
    }

    #[test]
    fn test_no_file() {
        let dir = std::env::temp_dir().join("mochi_nfo_test_nonexistent");
        assert!(read_nfo(&dir).is_none());
    }

    // ── write_nfo tests ───────────────────────────────────────────────────

    fn fresh_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi_nfo_write_{}", name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_xml_escape() {
        assert_eq!(xml_escape("hello & world"), "hello &amp; world");
        assert_eq!(xml_escape("<tag>"), "&lt;tag&gt;");
        assert_eq!(xml_escape(r#""quoted""#), "&quot;quoted&quot;");
        assert_eq!(xml_escape("'apos'"), "&apos;apos&apos;");
        assert_eq!(xml_escape("plain text"), "plain text");
    }

    #[test]
    fn test_write_tvshow_full() {
        let dir = fresh_dir("tvshow_full");
        let data = NfoWriteData {
            title: "黄泉使者".to_string(),
            plot: Some("冥界的使者来到人间".to_string()),
            year: Some(2025),
            genres: vec!["动画".to_string(), "奇幻".to_string()],
            tmdb_id: Some(249507),
            bangumi_id: Some(12345),
            series_type: "tv".to_string(),
        };
        let result = write_nfo(&dir, &data, None, None, false).unwrap();
        assert!(result.nfo_path.ends_with("tvshow.nfo"));
        assert!(result.sidecar_written.is_empty());

        let content = std::fs::read_to_string(&result.nfo_path).unwrap();
        assert!(content.contains("<?xml version=\"1.0\" encoding=\"UTF-8\""));
        assert!(content.contains("<tvshow>"));
        assert!(content.contains("<title>黄泉使者</title>"));
        assert!(content.contains("<plot>冥界的使者来到人间</plot>"));
        assert!(content.contains("<year>2025</year>"));
        assert!(content.contains("<genre>动画</genre>"));
        assert!(content.contains("<genre>奇幻</genre>"));
        assert!(content.contains("<uniqueid type=\"tmdb\">249507</uniqueid>"));
        assert!(content.contains("<uniqueid type=\"bangumi\">12345</uniqueid>"));
        assert!(content.contains("</tvshow>"));
    }

    #[test]
    fn test_write_movie_uses_movie_nfo() {
        let dir = fresh_dir("movie");
        let data = NfoWriteData {
            title: "Inception".to_string(),
            plot: Some("A & B < test".to_string()),
            year: Some(2010),
            genres: vec!["Sci-Fi".to_string()],
            tmdb_id: Some(27205),
            bangumi_id: None,
            series_type: "movie".to_string(),
        };
        let result = write_nfo(&dir, &data, None, None, false).unwrap();
        assert!(result.nfo_path.ends_with("movie.nfo"));

        let content = std::fs::read_to_string(&result.nfo_path).unwrap();
        assert!(content.contains("<movie>"));
        assert!(content.contains("A &amp; B &lt; test"));
        assert!(content.contains("<uniqueid type=\"tmdb\">27205</uniqueid>"));
        assert!(!content.contains("bangumi"));  // bangumi_id None → no tag
    }

    #[test]
    fn test_write_anime_uses_tvshow_nfo() {
        let dir = fresh_dir("anime");
        let data = NfoWriteData {
            title: "上伊那牡丹".to_string(),
            series_type: "anime".to_string(),
            bangumi_id: Some(100),
            ..Default::default()
        };
        let result = write_nfo(&dir, &data, None, None, false).unwrap();
        assert!(result.nfo_path.ends_with("tvshow.nfo"));
    }

    #[test]
    fn test_write_variety_uses_tvshow_nfo() {
        let dir = fresh_dir("variety");
        let data = NfoWriteData {
            title: "哈哈哈哈哈".to_string(),
            series_type: "variety".to_string(),
            ..Default::default()
        };
        let result = write_nfo(&dir, &data, None, None, false).unwrap();
        assert!(result.nfo_path.ends_with("tvshow.nfo"));
    }

    #[test]
    fn test_write_skips_existing() {
        let dir = fresh_dir("skip");
        let data = NfoWriteData {
            title: "Test".to_string(),
            series_type: "tv".to_string(),
            ..Default::default()
        };
        write_nfo(&dir, &data, None, None, false).unwrap();

        // Second write without overwrite should fail
        let err = write_nfo(&dir, &data, None, None, false).unwrap_err();
        assert!(err.contains("NFO already exists"), "got: {}", err);

        // With overwrite it succeeds
        let result = write_nfo(&dir, &data, None, None, true);
        assert!(result.is_ok());
    }

    #[test]
    fn test_write_omits_empty_optional_fields() {
        let dir = fresh_dir("minimal");
        let data = NfoWriteData {
            title: "Minimal".to_string(),
            series_type: "tv".to_string(),
            ..Default::default()
        };
        let result = write_nfo(&dir, &data, None, None, false).unwrap();
        let content = std::fs::read_to_string(&result.nfo_path).unwrap();
        // Title must be there
        assert!(content.contains("<title>Minimal</title>"));
        // Optional fields absent
        assert!(!content.contains("<plot>"));
        assert!(!content.contains("<year>"));
        assert!(!content.contains("<genre>"));
        assert!(!content.contains("<uniqueid"));
    }

    #[test]
    fn test_roundtrip_through_read_nfo() {
        let dir = fresh_dir("roundtrip");
        let data = NfoWriteData {
            title: "Roundtrip".to_string(),
            plot: Some("Verify the writer and parser agree.".to_string()),
            year: Some(2024),
            genres: vec!["Action".to_string(), "Drama".to_string()],
            series_type: "tv".to_string(),
            ..Default::default()
        };
        write_nfo(&dir, &data, None, None, false).unwrap();
        let read_back = read_nfo(&dir).expect("parser should find the NFO we just wrote");
        assert_eq!(read_back.synopsis.as_deref(), Some("Verify the writer and parser agree."));
        assert_eq!(read_back.year, Some(2024));
        let genres: Vec<String> = serde_json::from_str(read_back.genres.as_deref().unwrap()).unwrap();
        assert_eq!(genres, vec!["Action", "Drama"]);
    }

    // ── clear_nfo tests ─────────────────────────────────────────────────

    #[test]
    fn test_clear_nfo_removes_nfo_only() {
        let dir = fresh_dir("clear_nfo_only");
        let data = NfoWriteData {
            title: "Clear Me".to_string(),
            series_type: "tv".to_string(),
            ..Default::default()
        };
        write_nfo(&dir, &data, None, None, false).unwrap();
        // Manually create a sidecar so we can verify it survives
        std::fs::write(dir.join("poster.jpg"), b"fake jpg").unwrap();

        let result = clear_nfo(&dir, false).unwrap();
        assert_eq!(result.nfo_deleted.as_deref(), Some("tvshow.nfo"));
        assert!(result.sidecars_deleted.is_empty());

        assert!(!dir.join("tvshow.nfo").exists());
        assert!(dir.join("poster.jpg").exists());  // sidecar preserved
    }

    #[test]
    fn test_clear_nfo_with_sidecars() {
        let dir = fresh_dir("clear_with_sidecars");
        let data = NfoWriteData {
            title: "Clear All".to_string(),
            series_type: "tv".to_string(),
            ..Default::default()
        };
        write_nfo(&dir, &data, None, None, false).unwrap();
        std::fs::write(dir.join("poster.jpg"), b"jpg").unwrap();
        std::fs::write(dir.join("fanart.png"), b"png").unwrap();
        std::fs::write(dir.join("backdrop.jpg"), b"kept").unwrap();  // not a target

        let result = clear_nfo(&dir, true).unwrap();
        assert_eq!(result.nfo_deleted.as_deref(), Some("tvshow.nfo"));
        assert!(result.sidecars_deleted.contains(&"poster.jpg".to_string()));
        assert!(result.sidecars_deleted.contains(&"fanart.png".to_string()));
        assert_eq!(result.sidecars_deleted.len(), 2);

        assert!(!dir.join("tvshow.nfo").exists());
        assert!(!dir.join("poster.jpg").exists());
        assert!(!dir.join("fanart.png").exists());
        assert!(dir.join("backdrop.jpg").exists());  // non-target untouched
    }

    #[test]
    fn test_clear_nfo_idempotent() {
        let dir = fresh_dir("clear_idempotent");
        // Empty dir, no NFO, no sidecars
        let result = clear_nfo(&dir, true).unwrap();
        assert!(result.nfo_deleted.is_none());
        assert!(result.sidecars_deleted.is_empty());
        // Calling again on dir that previously had NFO
        let data = NfoWriteData {
            title: "Twice".to_string(),
            series_type: "tv".to_string(),
            ..Default::default()
        };
        write_nfo(&dir, &data, None, None, false).unwrap();
        clear_nfo(&dir, false).unwrap();
        let result = clear_nfo(&dir, true).unwrap();  // should be no-op
        assert!(result.nfo_deleted.is_none());
        assert!(result.sidecars_deleted.is_empty());
    }
}
