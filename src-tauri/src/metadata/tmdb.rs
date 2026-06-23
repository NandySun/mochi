//! TMDB REST API client.
//!
//! Requires a free API key (v3 auth). Register at <https://www.themoviedb.org/settings/api>.
//! Image base URL: <https://image.tmdb.org/t/p/>

use serde::{Deserialize, Serialize};

const TMDB_API_BASE: &str = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE: &str = "https://image.tmdb.org/t/p";

// ── Response types ────────────────────────────────────────────────────────────

/// A search result from TMDB (common to TV and movie).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmdbSearchResult {
    pub id: i64,
    pub name: Option<String>,       // TV shows use "name"
    pub title: Option<String>,      // Movies use "title"
    pub overview: Option<String>,
    #[serde(rename = "poster_path")]
    pub poster_path: Option<String>,
    #[serde(rename = "backdrop_path")]
    pub backdrop_path: Option<String>,
    #[serde(rename = "vote_average")]
    pub vote_average: Option<f64>,
    #[serde(rename = "first_air_date")]
    pub first_air_date: Option<String>,   // TV
    #[serde(rename = "release_date")]
    pub release_date: Option<String>,     // Movie
    #[serde(rename = "genre_ids")]
    pub genre_ids: Option<Vec<i32>>,
    pub genres: Option<Vec<TmdbGenre>>,   // Only in detail endpoint
    #[serde(rename = "media_type")]
    pub media_type: Option<String>,
}

impl TmdbSearchResult {
    /// Best-effort display name.
    pub fn display_name(&self) -> &str {
        self.name
            .as_deref()
            .or(self.title.as_deref())
            .unwrap_or("Unknown")
    }

    /// Best-effort year extraction.
    pub fn year(&self) -> Option<i32> {
        let date_str = self
            .first_air_date
            .as_deref()
            .or(self.release_date.as_deref())?;
        date_str[..4].parse().ok()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmdbGenre {
    pub id: i32,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct TmdbSearchResponse {
    results: Vec<TmdbSearchResult>,
}

#[derive(Debug, Clone, Deserialize)]
struct TmdbErrorResponse {
    status_message: Option<String>,
}

/// A single episode within a season response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmdbEpisodeResult {
    #[serde(rename = "episode_number")]
    pub episode_number: i32,
    pub name: Option<String>,
    pub overview: Option<String>,
    #[serde(rename = "still_path")]
    pub still_path: Option<String>,
    #[serde(rename = "air_date")]
    pub air_date: Option<String>,
    pub runtime: Option<i32>,
    #[serde(rename = "season_number")]
    pub season_number: i32,
}

/// Full season detail response from /tv/{id}/season/{number}.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmdbSeasonDetail {
    #[serde(rename = "season_number")]
    pub season_number: i32,
    pub name: Option<String>,
    pub overview: Option<String>,
    #[serde(rename = "poster_path")]
    pub poster_path: Option<String>,
    pub episodes: Vec<TmdbEpisodeResult>,
}

/// A cast member from TMDB credits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmdbCastMember {
    pub id: i64,
    pub name: String,
    pub character: Option<String>,
    #[serde(rename = "profile_path")]
    pub profile_path: Option<String>,
    pub order: i32,
}

/// Full credits response from /tv/{id}/credits or /movie/{id}/credits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmdbCreditsResponse {
    pub cast: Vec<TmdbCastMember>,
}

// ── Client ────────────────────────────────────────────────────────────────────

pub struct TmdbClient {
    api_key: String,
    client: reqwest::Client,
}

impl TmdbClient {
    pub fn new(api_key: &str, proxy_url: Option<&str>) -> Self {
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15));
        if let Some(url) = proxy_url {
            if let Ok(proxy) = reqwest::Proxy::all(url) {
                builder = builder.proxy(proxy);
            }
        }
        Self {
            api_key: api_key.to_string(),
            client: builder.build().expect("TMDB client build"),
        }
    }

    // ── Search ────────────────────────────────────────────────────────────────

    /// Search for TV shows.
    pub async fn search_tv(
        &self,
        query: &str,
        language: &str,
        page: u32,
    ) -> Result<Vec<TmdbSearchResult>, String> {
        self.do_search("search/tv", query, language, page).await
    }

    /// Search for movies.
    pub async fn search_movie(
        &self,
        query: &str,
        language: &str,
        page: u32,
    ) -> Result<Vec<TmdbSearchResult>, String> {
        self.do_search("search/movie", query, language, page)
            .await
    }

    // ── Detail ────────────────────────────────────────────────────────────────

    /// Get full TV details by ID (includes genre names).
    pub async fn get_tv_details(
        &self,
        id: i64,
        language: &str,
    ) -> Result<TmdbSearchResult, String> {
        let url = format!("{}/tv/{}", TMDB_API_BASE, id);
        self.do_detail(&url, language).await
    }

    /// Get full movie details by ID.
    pub async fn get_movie_details(
        &self,
        id: i64,
        language: &str,
    ) -> Result<TmdbSearchResult, String> {
        let url = format!("{}/movie/{}", TMDB_API_BASE, id);
        self.do_detail(&url, language).await
    }

    // ── Season (episode metadata) ──────────────────────────────────────────

    /// Get season details including episode list with stills and titles.
    pub async fn get_season(
        &self,
        tv_id: i64,
        season_number: i32,
        language: &str,
    ) -> Result<TmdbSeasonDetail, String> {
        let url = format!("{}/tv/{}/season/{}", TMDB_API_BASE, tv_id, season_number);
        let resp = self
            .client
            .get(&url)
            .query(&[
                ("api_key", self.api_key.as_str()),
                ("language", language),
            ])
            .send()
            .await
            .map_err(|e| format!("TMDB season request failed: {e}"))?;

        Self::check_response(&resp).await?;

        resp.json::<TmdbSeasonDetail>()
            .await
            .map_err(|e| format!("TMDB season parse error: {e}"))
    }

    // ── Credits (cast) ────────────────────────────────────────────────────

    /// Get cast & crew for a TV show or movie.
    pub async fn get_credits(
        &self,
        media_type: &str, // "tv" or "movie"
        id: i64,
        language: &str,
    ) -> Result<TmdbCreditsResponse, String> {
        let url = format!("{}/{}/{}/credits", TMDB_API_BASE, media_type, id);
        let resp = self
            .client
            .get(&url)
            .query(&[
                ("api_key", self.api_key.as_str()),
                ("language", language),
            ])
            .send()
            .await
            .map_err(|e| format!("TMDB credits request failed: {e}"))?;

        Self::check_response(&resp).await?;

        resp.json::<TmdbCreditsResponse>()
            .await
            .map_err(|e| format!("TMDB credits parse error: {e}"))
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    async fn do_search(
        &self,
        endpoint: &str,
        query: &str,
        language: &str,
        page: u32,
    ) -> Result<Vec<TmdbSearchResult>, String> {
        let url = format!("{}/{}", TMDB_API_BASE, endpoint);
        let resp = self
            .client
            .get(&url)
            .query(&[
                ("api_key", self.api_key.as_str()),
                ("query", query),
                ("language", language),
                ("page", &page.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("TMDB request failed: {e}"))?;

        Self::check_response(&resp).await?;

        let search_resp: TmdbSearchResponse = resp
            .json()
            .await
            .map_err(|e| format!("TMDB parse error: {e}"))?;

        Ok(search_resp.results)
    }

    async fn do_detail(&self, url: &str, language: &str) -> Result<TmdbSearchResult, String> {
        let resp = self
            .client
            .get(url)
            .query(&[
                ("api_key", self.api_key.as_str()),
                ("language", language),
            ])
            .send()
            .await
            .map_err(|e| format!("TMDB request failed: {e}"))?;

        Self::check_response(&resp).await?;

        let detail: TmdbSearchResult = resp
            .json()
            .await
            .map_err(|e| format!("TMDB parse error: {e}"))?;

        Ok(detail)
    }

    async fn check_response(resp: &reqwest::Response) -> Result<(), String> {
        if resp.status().is_success() {
            return Ok(());
        }
        Err(format!("TMDB returned HTTP {}", resp.status()))
    }
}

// ── Image URL helpers ─────────────────────────────────────────────────────────

/// Build a full TMDB image URL for the given size and path.
/// Common sizes: "w500" (poster), "w1280" (backdrop), "original".
pub fn tmdb_image_url(path: &str, size: &str) -> String {
    format!("{}/{}{}", TMDB_IMAGE_BASE, size, path)
}
