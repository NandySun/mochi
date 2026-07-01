//! Bangumi (bgm.tv) API client.
//!
//! Chinese ACG database. Free, no API key. Covers anime, manga, games, music.
//! Search: GET https://api.bgm.tv/search/subject/{keyword}
//! Detail: GET https://api.bgm.tv/v0/subjects/{id}

use serde::{Deserialize, Serialize};

// ── Response types ────────────────────────────────────────────────────────────

/// Search result from the /search/subject endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiSearchResult {
    pub id: i32,
    pub name: String,
    pub name_cn: String,
    pub summary: String,
    #[serde(rename = "air_date")]
    pub air_date: String,
    pub images: BangumiImages,
    /// Available with responseGroup=medium
    #[serde(default)]
    pub rating: Option<BangumiRating>,
    /// Available with responseGroup=medium
    #[serde(default)]
    pub tags: Vec<BangumiTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiImages {
    pub large: Option<String>,
    pub common: Option<String>,
    pub medium: Option<String>,
    pub small: Option<String>,
    pub grid: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct BangumiSearchResponse {
    #[allow(dead_code)]
    results: u32,
    list: Vec<BangumiSearchResult>,
}

/// Full subject detail from /v0/subjects/{id}.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiSubjectDetail {
    pub id: i32,
    pub name: String,
    pub name_cn: String,
    pub summary: String,
    pub images: BangumiImages,
    pub rating: Option<BangumiRating>,
    pub tags: Vec<BangumiTag>,
    pub date: String,
    #[serde(rename = "total_episodes")]
    #[serde(default)]
    pub total_episodes: i32,
    #[serde(rename = "type")]
    pub subject_type: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiRating {
    pub score: Option<f64>,
    pub rank: Option<i32>,
    pub total: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiTag {
    pub name: String,
    pub count: i32,
}

// ── Characters ─────────────────────────────────────────────────────────────

/// A character from /v0/subjects/{id}/characters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiCharacter {
    pub id: i32,
    pub name: String,
    /// Character-actor relationship (e.g. "主角", "配角")
    pub relation: Option<String>,
    pub images: Option<BangumiImages>,
    pub actors: Option<Vec<BangumiCharacterActor>>,
}

/// A voice actor linked to a character.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiCharacterActor {
    pub id: i32,
    pub name: String,
    pub images: Option<BangumiImages>,
}

// ── Client ────────────────────────────────────────────────────────────────────

pub struct BangumiClient {
    client: reqwest::Client,
}

impl BangumiClient {
    pub fn with_proxy(proxy_url: Option<&str>) -> Self {
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Mochi/0.1 (personal media library)");
        if let Some(url) = proxy_url {
            if let Ok(proxy) = reqwest::Proxy::all(url) {
                builder = builder.proxy(proxy);
            }
        } else if let Some(url) = crate::system_proxy::system_proxy_url() {
            if let Ok(proxy) = reqwest::Proxy::all(&url) {
                builder = builder.proxy(proxy);
            }
        }
        Self {
            client: builder.build().expect("Bangumi client build"),
        }
    }

    /// Search for anime by keyword. Returns up to 5 results.
    /// Uses the old search endpoint which is simpler than v0 POST.
    pub async fn search(&self, query: &str) -> Result<Vec<BangumiSearchResult>, String> {
        let url = format!(
            "https://api.bgm.tv/search/subject/{}",
            urlencoding(query)
        );
        let resp = self
            .client
            .get(&url)
            .query(&[
                ("type", "2"), // anime
                ("max_results", "5"),
                ("responseGroup", "medium"),
            ])
            .send()
            .await
            .map_err(|e| format!("Bangumi request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Bangumi returned HTTP {}", resp.status()));
        }

        let body = resp
            .text()
            .await
            .map_err(|e| format!("Bangumi read error: {e}"))?;

        // The old search endpoint may return an empty list as `[]`
        // or a proper response with `list` field
        match serde_json::from_str::<BangumiSearchResponse>(&body) {
            Ok(parsed) => return Ok(parsed.list),
            Err(_) => {}
        }
        // Fallback: try parsing as a flat array (some API versions)
        match serde_json::from_str::<Vec<BangumiSearchResult>>(&body) {
            Ok(list) => Ok(list),
            Err(_) => {
                // Maybe the API returned something else or an error page
                if body.trim().starts_with('[') || body.trim().starts_with('{') {
                    Err(format!("Bangumi parse error: unexpected response format"))
                } else {
                    Err(format!("Bangumi response was not JSON: {}", &body[..body.len().min(200)]))
                }
            }
        }
    }

    /// Fetch full metadata for a specific Bangumi subject ID.
    pub async fn get_by_id(&self, id: i32) -> Result<BangumiSubjectDetail, String> {
        let url = format!("https://api.bgm.tv/v0/subjects/{}", id);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Bangumi request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Bangumi returned HTTP {}", resp.status()));
        }

        resp.json::<BangumiSubjectDetail>()
            .await
            .map_err(|e| format!("Bangumi parse error: {e}"))
    }

    /// Fetch characters and voice actors for a subject.
    /// GET /v0/subjects/{subject_id}/characters
    pub async fn get_characters(&self, subject_id: i32) -> Result<Vec<BangumiCharacter>, String> {
        let url = format!("https://api.bgm.tv/v0/subjects/{}/characters", subject_id);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Bangumi characters request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Bangumi characters returned HTTP {}", resp.status()));
        }

        resp.json::<Vec<BangumiCharacter>>()
            .await
            .map_err(|e| format!("Bangumi characters parse error: {e}"))
    }
}

/// Minimal URL-encoding for the search keyword (old endpoint uses path segment).
fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            '/' => "%2F".to_string(),
            '?' => "%3F".to_string(),
            '#' => "%23".to_string(),
            '&' => "%26".to_string(),
            '=' => "%3D".to_string(),
            other => {
                let b = other as u32;
                if b < 0x80 && other.is_ascii_alphanumeric() || other == '-' || other == '_'
                    || other == '.' || other == '~'
                {
                    other.to_string()
                } else {
                    // Percent-encode non-ASCII / special chars via UTF-8 bytes
                    let mut buf = [0u8; 4];
                    let encoded = other.encode_utf8(&mut buf);
                    encoded
                        .bytes()
                        .map(|b| format!("%{:02X}", b))
                        .collect::<Vec<_>>()
                        .join("")
                }
            }
        })
        .collect()
}

impl Default for BangumiClient {
    fn default() -> Self {
        Self::with_proxy(None)
    }
}
