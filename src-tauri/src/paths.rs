//! Platform-aware data directory resolution.
//!
//! Portable mode (`.portable` marker next to exe): data lives alongside the binary.
//! Installed mode (no marker): data lives in %APPDATA%/mochi/.

use std::path::PathBuf;

/// Return the data root directory, creating it if needed.
///
/// # Portable mode detection
/// If a `.portable` file exists in the same directory as the executable,
/// data is stored alongside the exe. Otherwise, `%APPDATA%/mochi/` is used.
pub fn data_root() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("无法获取 exe 路径: {e}"))?
        .parent()
        .ok_or("exe 路径没有父目录")?
        .to_path_buf();

    let root = if exe_dir.join(".portable").exists() {
        exe_dir
    } else {
        let appdata = std::env::var("APPDATA")
            .map_err(|_| "APPDATA 环境变量未设置".to_string())?;
        PathBuf::from(&appdata).join("mochi")
    };

    std::fs::create_dir_all(&root)
        .map_err(|e| format!("无法创建数据目录: {e}"))?;

    Ok(root)
}

/// Convenience: data_root()/cache/
pub fn cache_root() -> Result<PathBuf, String> {
    let dir = data_root()?.join("cache");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("无法创建缓存目录: {e}"))?;
    Ok(dir)
}
