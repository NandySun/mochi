//! .mochi 文件读写模块
//!
//! .mochi 是用户裁决的持久化缓存文件，存放在系列文件夹内或 `.mochi/` 扁平目录中。
//! 纯文本 key=value 格式，顺序无关，字段按需生长。

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// 从 .mochi 文件解析出的裁决数据。
///
/// 所有字段均为 Option：文件不存在时全为 None，部分字段缺失时对应字段为 None。
#[derive(Debug, Clone, Default)]
pub struct MochiFile {
    /// 系列类型：anime / tv / movie / unknown
    pub series_type: Option<String>,
    /// TMDB 节目/电影 ID
    pub tmdb_id: Option<i64>,
    /// Bangumi 条目 ID
    pub bangumi_id: Option<i64>,
    /// 手动修正的搜索词
    pub search_term: Option<String>,
    /// 上次拉取元数据的时间戳（ISO 8601）
    pub last_fetched: Option<String>,
}

impl MochiFile {
    /// 创建全空 MochiFile
    pub fn new() -> Self {
        Self::default()
    }

    /// 是否有任何字段非空
    pub fn has_any(&self) -> bool {
        self.series_type.is_some()
            || self.tmdb_id.is_some()
            || self.bangumi_id.is_some()
            || self.search_term.is_some()
            || self.last_fetched.is_some()
    }

    /// 非空字段数量，用于判断是否是用户手动维护的富内容。
    /// 仅 type 一行视为 mochi 自动写入；多于一行说明用户手动编辑过。
    pub fn field_count(&self) -> usize {
        let mut count = 0;
        if self.series_type.is_some() { count += 1; }
        if self.tmdb_id.is_some() { count += 1; }
        if self.bangumi_id.is_some() { count += 1; }
        if self.search_term.is_some() { count += 1; }
        if self.last_fetched.is_some() { count += 1; }
        count
    }
}

/// 读取系列文件夹内的 `.mochi` 文件。
///
/// 文件不存在时返回全空 MochiFile（不报错）。
pub fn read_mochi(dir_path: &Path) -> Result<MochiFile, String> {
    let file_path = dir_path.join(".mochi");
    if !file_path.is_file() {
        return Ok(MochiFile::new());
    }
    parse_mochi_file(&file_path)
}

/// 扁平模式：读取 root_path/.mochi/{series_name}.mochi。
///
/// 内部复用 parse_mochi_file 逻辑。
pub fn read_mochi_flat(root_path: &Path, series_name: &str) -> Result<MochiFile, String> {
    let file_path = root_path.join(".mochi").join(format!("{}.mochi", series_name));
    if !file_path.is_file() {
        return Ok(MochiFile::new());
    }
    parse_mochi_file(&file_path)
}

/// 写入 `.mochi` 文件到系列文件夹内。
///
/// 只写入 Some 字段，None 字段不写入。
/// 先写临时文件再原子重命名，防止写一半崩溃导致文件损坏。
pub fn write_mochi(dir_path: &Path, mochi: &MochiFile) -> Result<(), String> {
    let file_path = dir_path.join(".mochi");
    let temp_path = dir_path.join(".mochi.tmp");

    // 确保目录存在
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }

    // 构建文件内容
    let mut content = String::new();
    if let Some(ref t) = mochi.series_type {
        content.push_str(&format!("type={}\n", t));
    }
    if let Some(id) = mochi.tmdb_id {
        content.push_str(&format!("tmdb_id={}\n", id));
    }
    if let Some(id) = mochi.bangumi_id {
        content.push_str(&format!("bangumi_id={}\n", id));
    }
    if let Some(ref term) = mochi.search_term {
        content.push_str(&format!("search_term={}\n", term));
    }
    if let Some(ref ts) = mochi.last_fetched {
        content.push_str(&format!("last_fetched={}\n", ts));
    }

    // 原子写入：临时文件 → 重命名
    fs::write(&temp_path, content.as_bytes())
        .map_err(|e| format!("写入临时文件失败: {e}"))?;
    fs::rename(&temp_path, &file_path)
        .map_err(|e| format!("重命名临时文件失败: {e}"))?;

    Ok(())
}

/// 写入扁平模式 `.mochi` 文件到 root_path/.mochi/{series_name}.mochi。
pub fn write_mochi_flat(root_path: &Path, series_name: &str, mochi: &MochiFile) -> Result<(), String> {
    let dir = root_path.join(".mochi");
    fs::create_dir_all(&dir).map_err(|e| format!("创建 .mochi 目录失败: {e}"))?;
    let file_path = dir.join(format!("{}.mochi", series_name));
    let temp_path = dir.join(format!("{}.mochi.tmp", series_name));

    let mut content = String::new();
    if let Some(ref t) = mochi.series_type {
        content.push_str(&format!("type={}\n", t));
    }
    if let Some(id) = mochi.tmdb_id {
        content.push_str(&format!("tmdb_id={}\n", id));
    }
    if let Some(id) = mochi.bangumi_id {
        content.push_str(&format!("bangumi_id={}\n", id));
    }
    if let Some(ref term) = mochi.search_term {
        content.push_str(&format!("search_term={}\n", term));
    }
    if let Some(ref ts) = mochi.last_fetched {
        content.push_str(&format!("last_fetched={}\n", ts));
    }

    fs::write(&temp_path, content.as_bytes())
        .map_err(|e| format!("写入临时文件失败: {e}"))?;
    fs::rename(&temp_path, &file_path)
        .map_err(|e| format!("重命名临时文件失败: {e}"))?;

    Ok(())
}

// ── 内部解析 ─────────────────────────────────────────────────────────────────

/// 解析 .mochi 文件的通用逻辑。
fn parse_mochi_file(file_path: &Path) -> Result<MochiFile, String> {
    let file = fs::File::open(file_path)
        .map_err(|e| format!("无法打开 .mochi 文件 {}: {e}", file_path.display()))?;
    let reader = BufReader::new(file);
    let mut mochi = MochiFile::new();

    for (line_no, line_result) in reader.lines().enumerate() {
        let line = line_result.map_err(|e| format!("读取第 {} 行失败: {e}", line_no + 1))?;
        let trimmed = line.trim();

        // 跳过空行和注释
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // 拆分 key=value
        let (key, value) = match trimmed.split_once('=') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => continue, // 格式错误的行，静默跳过
        };

        match key {
            "type" => mochi.series_type = Some(value.to_string()),
            "tmdb_id" => {
                if let Ok(id) = value.parse::<i64>() {
                    mochi.tmdb_id = Some(id);
                }
            }
            "bangumi_id" => {
                if let Ok(id) = value.parse::<i64>() {
                    mochi.bangumi_id = Some(id);
                }
            }
            "search_term" => mochi.search_term = Some(value.to_string()),
            "last_fetched" => mochi.last_fetched = Some(value.to_string()),
            _ => { /* 未知 key，静默跳过以支持未来扩展 */ }
        }
    }

    Ok(mochi)
}

// ── 测试 ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join("mochi_test_mochi_file");
        let _ = fs::create_dir_all(&dir);
        dir
    }

    fn write_test_file(dir: &Path, name: &str, content: &str) {
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
    }

    #[test]
    fn test_read_full_mochi() {
        let dir = temp_dir().join("test_full");
        let _ = fs::create_dir_all(&dir);
        write_test_file(&dir, ".mochi", "type=tv\ntmdb_id=249507\nbangumi_id=0\nsearch_term=黄泉使者\nlast_fetched=2026-06-21T17:32:00+08:00\n");

        let mochi = read_mochi(&dir).unwrap();
        assert_eq!(mochi.series_type, Some("tv".to_string()));
        assert_eq!(mochi.tmdb_id, Some(249507));
        assert_eq!(mochi.bangumi_id, Some(0));
        assert_eq!(mochi.search_term, Some("黄泉使者".to_string()));
        assert_eq!(mochi.last_fetched, Some("2026-06-21T17:32:00+08:00".to_string()));
    }

    #[test]
    fn test_read_partial_mochi() {
        let dir = temp_dir().join("test_partial");
        let _ = fs::create_dir_all(&dir);
        write_test_file(&dir, ".mochi", "type=anime\nsearch_term=上伊那牡丹\n");

        let mochi = read_mochi(&dir).unwrap();
        assert_eq!(mochi.series_type, Some("anime".to_string()));
        assert_eq!(mochi.search_term, Some("上伊那牡丹".to_string()));
        assert_eq!(mochi.tmdb_id, None);
        assert_eq!(mochi.bangumi_id, None);
    }

    #[test]
    fn test_read_missing_file() {
        let dir = temp_dir().join("test_missing");
        let _ = fs::create_dir_all(&dir);

        let mochi = read_mochi(&dir).unwrap();
        assert!(mochi.series_type.is_none());
        assert!(mochi.tmdb_id.is_none());
    }

    #[test]
    fn test_read_with_comments_and_blanks() {
        let dir = temp_dir().join("test_comments");
        let _ = fs::create_dir_all(&dir);
        write_test_file(&dir, ".mochi", "# 这是注释\ntype=movie\n\n# 另一条注释\ntmdb_id=123\n");

        let mochi = read_mochi(&dir).unwrap();
        assert_eq!(mochi.series_type, Some("movie".to_string()));
        assert_eq!(mochi.tmdb_id, Some(123));
    }

    #[test]
    fn test_read_unknown_key() {
        let dir = temp_dir().join("test_unknown_key");
        let _ = fs::create_dir_all(&dir);
        write_test_file(&dir, ".mochi", "type=tv\nunknown_field=blah\n");

        let mochi = read_mochi(&dir).unwrap();
        assert_eq!(mochi.series_type, Some("tv".to_string()));
    }

    #[test]
    fn test_write_and_roundtrip() {
        let dir = temp_dir().join("test_roundtrip");
        let _ = fs::create_dir_all(&dir);

        let mochi = MochiFile {
            series_type: Some("tv".to_string()),
            tmdb_id: Some(42),
            bangumi_id: None,
            search_term: Some("测试".to_string()),
            last_fetched: None,
        };

        write_mochi(&dir, &mochi).unwrap();
        let read_back = read_mochi(&dir).unwrap();

        assert_eq!(read_back.series_type, Some("tv".to_string()));
        assert_eq!(read_back.tmdb_id, Some(42));
        assert_eq!(read_back.search_term, Some("测试".to_string()));
        assert_eq!(read_back.bangumi_id, None);
        assert_eq!(read_back.last_fetched, None);
    }

    #[test]
    fn test_flat_mode() {
        let root = temp_dir().join("test_flat");
        let mochi_dir = root.join(".mochi");
        let _ = fs::create_dir_all(&mochi_dir);
        write_test_file(&mochi_dir, "黄泉使者.mochi", "type=tv\ntmdb_id=249507\n");

        let mochi = read_mochi_flat(&root, "黄泉使者").unwrap();
        assert_eq!(mochi.series_type, Some("tv".to_string()));
        assert_eq!(mochi.tmdb_id, Some(249507));
    }

    #[test]
    fn test_flat_write() {
        let root = temp_dir().join("test_flat_write");

        let mochi = MochiFile {
            series_type: Some("anime".to_string()),
            tmdb_id: None,
            bangumi_id: Some(123),
            search_term: None,
            last_fetched: None,
        };

        write_mochi_flat(&root, "测试系列", &mochi).unwrap();
        let read_back = read_mochi_flat(&root, "测试系列").unwrap();

        assert_eq!(read_back.series_type, Some("anime".to_string()));
        assert_eq!(read_back.bangumi_id, Some(123));
    }

    #[test]
    fn test_field_count() {
        let mochi = MochiFile {
            series_type: Some("tv".to_string()),
            tmdb_id: Some(1),
            ..Default::default()
        };
        assert_eq!(mochi.field_count(), 2);
        assert!(mochi.has_any());
    }

    #[test]
    fn test_empty_has_any() {
        let mochi = MochiFile::new();
        assert!(!mochi.has_any());
        assert_eq!(mochi.field_count(), 0);
    }
}
