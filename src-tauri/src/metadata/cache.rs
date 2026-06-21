//! Image download and local caching.
//!
//! All downloaded images live in `%APPDATA%/mochi/cache/`.
//! Cached images are never evicted automatically; the directory
//! can be cleared manually at any time (mochi will re-download on next fetch).

use std::path::{Path, PathBuf};

/// Return the cache directory, creating it if needed.
pub fn cache_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
    let dir = Path::new(&appdata).join("mochi").join("cache");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create cache dir: {e}"))?;
    Ok(dir)
}

/// Download an image from `url` and save it to `cache_path`.
/// If the file already exists and `force` is false, skip download.
pub async fn download_image(url: &str, cache_path: &Path, proxy_url: Option<&str>, force: bool) -> Result<(), String> {
    if !force && cache_path.exists() && cache_path.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
        return Ok(());
    }

    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30));
    if let Some(p) = proxy_url {
        if let Ok(proxy) = reqwest::Proxy::all(p) {
            builder = builder.proxy(proxy);
        }
    }
    let client = builder.build().map_err(|e| format!("Image client build failed: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Image download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Image download returned HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Image download read error: {e}"))?;

    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create cache parent dir: {e}"))?;
    }

    std::fs::write(cache_path, &bytes)
        .map_err(|e| format!("Failed to write cache file: {e}"))?;

    Ok(())
}

/// Build a cache file path for an AniList poster or banner.
pub fn anilist_cache_path(kind: &str, id: i32) -> Result<PathBuf, String> {
    let ext = if kind == "banner" { "jpg" } else { "jpg" };
    let filename = format!("anilist_{}_{}.{}", id, kind, ext);
    Ok(cache_dir()?.join(filename))
}

/// Build a cache file path for a TMDB poster or banner.
pub fn tmdb_cache_path(kind: &str, id: i64) -> Result<PathBuf, String> {
    let ext = if kind == "banner" { "jpg" } else { "jpg" };
    let filename = format!("tmdb_{}_{}.{}", id, kind, ext);
    Ok(cache_dir()?.join(filename))
}

/// Build a cache file path for a Bangumi poster.
pub fn bangumi_cache_path(kind: &str, id: i32) -> Result<PathBuf, String> {
    let filename = format!("bangumi_{}_{}.jpg", id, kind);
    Ok(cache_dir()?.join(filename))
}
