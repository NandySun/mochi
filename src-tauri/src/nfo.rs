//! Kodi NFO file parser.
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
}
