//! AniList GraphQL API client.
//!
//! Free, no API key required. Rate limit: ~90 requests/minute.
//! Endpoint: <https://graphql.anilist.co>

use serde::{Deserialize, Serialize};

const ANILIST_API: &str = "https://graphql.anilist.co";

// ── Request types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GraphqlRequest {
    query: String,
    variables: serde_json::Value,
}

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListSearchResult {
    pub id: i32,
    pub title: AniListTitle,
    #[serde(rename = "coverImage")]
    pub cover_image: AniListImage,
    #[serde(rename = "bannerImage")]
    pub banner_image: Option<String>,
    pub description: Option<String>,
    pub genres: Vec<String>,
    #[serde(rename = "averageScore")]
    pub average_score: Option<i32>,
    pub episodes: Option<i32>,
    #[serde(rename = "seasonYear")]
    pub season_year: Option<i32>,
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListTitle {
    pub romaji: Option<String>,
    pub english: Option<String>,
    pub native: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListImage {
    pub large: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct AniListPageResponse {
    data: Option<AniListPageData>,
    errors: Option<Vec<AniListError>>,
}

#[derive(Debug, Clone, Deserialize)]
struct AniListPageData {
    #[serde(rename = "Page")]
    page: AniListPage,
}

#[derive(Debug, Clone, Deserialize)]
struct AniListPage {
    media: Vec<AniListSearchResult>,
}

#[derive(Debug, Clone, Deserialize)]
struct AniListMediaResponse {
    data: Option<AniListMediaData>,
    errors: Option<Vec<AniListError>>,
}

#[derive(Debug, Clone, Deserialize)]
struct AniListMediaData {
    #[serde(rename = "Media")]
    media: AniListSearchResult,
}

#[derive(Debug, Clone, Deserialize)]
struct AniListError {
    message: String,
}

// ── Client ────────────────────────────────────────────────────────────────────

pub struct AniListClient {
    client: reqwest::Client,
}

impl AniListClient {
    pub fn with_proxy(proxy_url: Option<&str>) -> Self {
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10));
        if let Some(url) = proxy_url {
            if let Ok(proxy) = reqwest::Proxy::all(url) {
                builder = builder.proxy(proxy);
            }
        }
        Self { client: builder.build().expect("AniList client build") }
    }

    /// Search for anime by name. Returns up to 5 results.
    pub async fn search(&self, query: &str) -> Result<Vec<AniListSearchResult>, String> {
        let gql = r#"
        query ($search: String) {
            Page(perPage: 5) {
                media(search: $search, type: ANIME) {
                    id
                    title { romaji english native }
                    coverImage { large }
                    bannerImage
                    description
                    genres
                    averageScore
                    episodes
                    seasonYear
                    format
                }
            }
        }"#;

        let body = GraphqlRequest {
            query: gql.to_string(),
            variables: serde_json::json!({ "search": query }),
        };

        let resp = self
            .client
            .post(ANILIST_API)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("AniList request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("AniList returned HTTP {}", resp.status()));
        }

        let page_resp: AniListPageResponse = resp
            .json()
            .await
            .map_err(|e| format!("AniList parse error: {e}"))?;

        if let Some(errors) = page_resp.errors {
            let msgs: Vec<_> = errors.iter().map(|e| e.message.clone()).collect();
            return Err(format!("AniList errors: {}", msgs.join("; ")));
        }

        match page_resp.data {
            Some(data) => Ok(data.page.media),
            None => Ok(vec![]),
        }
    }

    /// Fetch full metadata for a specific AniList media ID.
    pub async fn get_by_id(&self, id: i32) -> Result<AniListSearchResult, String> {
        let gql = r#"
        query ($id: Int) {
            Media(id: $id) {
                id
                title { romaji english native }
                coverImage { large }
                bannerImage
                description
                genres
                averageScore
                episodes
                seasonYear
                format
            }
        }"#;

        let body = GraphqlRequest {
            query: gql.to_string(),
            variables: serde_json::json!({ "id": id }),
        };

        let resp = self
            .client
            .post(ANILIST_API)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("AniList request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("AniList returned HTTP {}", resp.status()));
        }

        let media_resp: AniListMediaResponse = resp
            .json()
            .await
            .map_err(|e| format!("AniList parse error: {e}"))?;

        if let Some(errors) = media_resp.errors {
            let msgs: Vec<_> = errors.iter().map(|e| e.message.clone()).collect();
            return Err(format!("AniList errors: {}", msgs.join("; ")));
        }

        media_resp
            .data
            .map(|d| d.media)
            .ok_or_else(|| "AniList returned null data".to_string())
    }
}

impl Default for AniListClient {
    fn default() -> Self {
        Self::with_proxy(None)
    }
}
