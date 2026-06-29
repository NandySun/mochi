# 待办：.nfo 解析 + Trakt 集成

> 2026-06-26 记录，来自小众软件论坛用户反馈。下次更新功能时一起做。

---

## 一、.nfo 文件解析

### 背景

Jellyfin / Kodi 用户迁移过来时，系列文件夹内已有 `.nfo` 文件（Kodi XML 格式），包含标题、简介、年份、类型、演员等描述性元数据。目前 mochi 扫描时只识别 poster.jpg / fanart.jpg，不读 .nfo。

用户诉求：避免重复刮削，迁移时直接继承现有元数据。

### 范围

解析 Kodi 格式的 `tvshow.nfo`（系列级）和 `<episode>.nfo`（剧集级）。

.nfo 中的 `<fileinfo>`（视频技术参数如 codec、durationinseconds）**不保证存在**，不作为可靠数据源。主力目标是描述性字段：title、originaltitle、plot、year、premiered、genre、director、actor。

### 策略

**分层导入**：

1. **扫描时导入**：发现文件夹内有 .nfo → 解析 → 写入 DB（title、year、synopsis、genres）
2. **拉取时覆盖**：用户主动从 Bangumi / TMDB 拉取元数据 → 在线数据覆盖 .nfo 字段（在线数据更丰富：评分、演员头像、剧集缩略图）

不需要用户在 .nfo 和在线数据之间手动选择。

### 实现要点

- 纯 XML 解析，不需要 ffprobe 或任何二进制依赖
- Rust 端：`src-tauri/src/scanner.rs` 扫描系列时新增 .nfo 检测
- 解析库候选：`quick-xml` + `serde`，或简单的手动 SAX 解析
- .nfo 中 `<uniqueid>` 可提取 TMDB/Bangumi ID，加速后续精确匹配
- 边界情况：同文件夹同时存在 .nfo 和 poster.jpg，两者独立识别不冲突

---

## 二、Trakt 同步

### 背景

Trakt.tv 是一个观影记录同步服务（类似 Last.fm 对音乐做的事）。用户在不同播放器间的观看进度通过 Trakt 云同步保持一致。

论坛用户反馈：mpv 脚本实现了「同步观看记录和进度到 trakt」，希望在 mochi 里也能用。不需要 mpv 脚本——mochi 直接调 Trakt API。

### 范围

- **上报**：播放完成 / 暂停时，自动向 Trakt 上报当前进度（scrobble / check-in）
- **拉取**：可选，从 Trakt 拉回历史进度用于首次导入
- **不做的**：Trakt 的社交功能（关注、评论）、推荐发现、年度报告——这些都是 Trakt 网站/app 侧的事，mochi 只做进度同步

### 策略

- 设置页新增「Trakt」区块：输入 Trakt 用户名或 OAuth 授权
- 默认关闭，用户主动开启后才同步
- 与 mochi 现有的 `watched_progress` 字段无缝衔接：进度变化 → 调 Trakt API
- 免费 Trakt 账号即可，无付费墙

### 实现要点

- Trakt API v2（`https://api.trakt.tv`），需要 OAuth 2.0 或 PIN 授权
- Rust 端新增 `src-tauri/src/trakt.rs`
- 关键 endpoint：
  - `POST /scrobble/start` — 开始播放
  - `POST /scrobble/pause` — 暂停（附进度）
  - `POST /scrobble/stop` — 停止播放
  - `POST /sync/history` — 标记已看完
- 防抖：每 10 秒上报一次，和现有的进度保存节奏一致
- 离线队列：网络不可达时暂存本地，恢复后补发

---

## 三、优先级

| 序号 | 功能 | 理由 |
|------|------|------|
| 1 | .nfo 解析 | 低实现成本（纯 XML），高迁移价值。直接解决用户「不想重复刮削」的核心诉求 |
| 2 | Trakt 同步 | 独立功能模块，不影响现有架构。用户需求明确但受众面可能较窄 |

两者之间无依赖关系，可以分开发。
