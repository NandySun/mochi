# Changelog

## v0.2.2 (2026-06-26)

### 新增功能

- **数据管理 Tab**：新增"数据"设置 Tab，提供图片缓存、元数据、裁决数据、观看记录、恢复出厂设置五项独立管理。每项显示当前状态、后果说明和确认弹窗。初始化操作清空全部本地数据并恢复到首次启动状态。
- **添加目录自动扫描**：设置页添加媒体库目录后立即触发扫描，无需手动点击"重新扫描"。
- **Onboarding 直接导入**：Onboarding 新增"选择已有文件夹"入口，选择已有媒体目录直接入库扫描，无需经过设置页。
- **批量拉取取消**：批量拉取进行中可随时取消，Rust 侧通过 `AtomicBool` 标志在循环中检测。
- **批量拉取状态恢复**：退出设置页后重新进入，若批量拉取仍在运行，自动恢复进度显示。
- **启动清理**：应用启动时自动清除上次异常退出残留的批量拉取状态文件和 localStorage 标记。
- **对话框浏览**：补装 `tauri-plugin-dialog` 并声明权限，添加媒体库文件夹时弹出系统原生目录选择窗口。
- **TMDB rate limit**：批量拉取每系列间隔 250ms，避免触发 TMDB 免费 API 限流。
- **后端命令**：新增 `get_data_stats`、`reset_metadata`、`clear_watch_progress`、`factory_reset` 四个命令支持数据管理。

### 架构改进

- **批量拉取元数据迁移至 Rust 后端**：批量拉取不再依赖前端 JS 循环，改为 Rust 侧异步任务执行，通过 Tauri 事件驱动进度展示。解决了进程崩溃/窗口关闭后 localStorage 标记残留导致"后台拉取中..."永久卡死的 bug。
- **提取 `fetch_series_metadata` 辅助函数**：单系列拉取（`fetch_metadata` 命令）与批量拉取共享 ID 快取路径 + 搜索 + TMDB backdrop 补齐逻辑，消除代码重复。
- **扫描器元数据保护**：`upsert_series` 的 `DO UPDATE SET` 对 `poster_path`、`fanart_path`、`bangumi_id`、`tmdb_id`、`synopsis`、`year`、`genres`、`score` 使用 `COALESCE(excluded.xxx, series.xxx)`，扫描器返回 `None` 时保留已拉取的元数据。重新扫描不再清空简介和评分。
- **嵌套 Season 子目录支持**：`scan_series_folder` 新增 season 子目录检测：遍历 depth-1 子目录 → 用 `extract_season_from_name` 提取季号 → 收集视频文件并关联 parent_season。season 优先级：文件名 SXXEXX > 父目录季号 > 文件夹默认。同步收集子目录中的字幕和临时下载文件。

### Bug 修复

- **重新扫描覆盖元数据**：扫描器写入 `None` 值覆盖已拉取的简介、评分等 → `upsert_series` 使用 `COALESCE` 保护元数据字段。
- **"后台拉取中…"永久卡死**：进程异常退出后 `localStorage` 标记残留 → 改为 Rust 侧状态文件 + 启动清理。
- **添加文件夹无浏览窗口**：缺失 `tauri-plugin-dialog` Rust 端依赖及 `capabilities/default.json` 权限声明，导致 `open()` 被 ACL 拦截后静默 fallback 到文本输入。
- **退出设置页后批量拉取状态消失**：`get_batch_status` 判断逻辑反了 → 改为直接查询共享进度 `BATCH_PROGRESS`。
- **空文件夹触发裁决**：扫描器对无视频文件的目录仍然生成 `SeriesScan` → 两处 `series_list.push` 前增加 `episodes.is_empty()` 检查。
- **默认路径 `D:\Video`**：首次使用时不预设任何媒体库路径，引导用户自行添加。
- **多 Season 横滚 Strip 混合排列**：详情页剧集缩略图横滚 strip 将 S2 紧接 S1 之后，无季节边界感知 → 改为按 Season pill 分组过滤，仅显示当前选中季。Season pill 替换 EpisodeModal 中的原生 `<select>` 下拉，两处统一为暖金高亮 `#c47e3a` 风格。
- **竞态条件导致删除的目录重新出现**：`removeDir` 派发 `mochi:data-changed` 事件时 localStorage 尚未更新，事件监听器读到旧数据覆盖了删除结果 → 改为先写 localStorage 再派发事件。
- **Vite 构建产物绝对路径导致 release exe 加载失败**：`vite.config.ts` 添加 `base: ''` 使输出使用相对路径，兼容 Tauri 嵌入式协议解析。
- **工具链配置**：修复 `dlltool.exe` 缺失导致 GNU 工具链 dev 编译失败的问题，清理 PATH 中的过期 D 盘 mingw 条目。

### 交互优化

- **全局拖放导入媒体库**：从资源管理器拖文件夹或视频文件到 mochi 窗口即可导入。拖入时全屏显示虚线边框提示（新增 `DropOverlay.tsx`）。支持拖入目录直接入库、拖入单文件自动取其父目录入库、拖入重复目录自动去重、拖入已覆盖子目录则增量扫描已有 rootDir。
- **媒体库添加改为输入框 + 浏览按钮**：点击「＋ 添加文件夹」展开输入行，包含路径输入框、浏览按钮（调用系统目录选择器）、类型选择器和确认按钮。用户可手写路径或浏览选择，不再弹窗优先。
- **已添加目录的类型标签可切换**：列表中每条路径的类型标签改为按钮，点击循环切换（自动 → 动漫 → 电影 → 影视 → 综艺），立即持久化到 localStorage。
- **TMDB Key 显隐按钮去除 emoji**：「👁/🙈」改为文字「显示/隐藏」，符合 mochi 设计语言。
- **移除媒体库目录级联清理 DB**：删除设置页中的媒体库目录时，Rust 侧通过 `delete_series_by_root_path` 清理该路径下所有系列及关联剧集、演员数据。修复了旧行为只清列表不清 DB 导致海报残留的问题。

### 设置页结构

- **媒体库 Tab 分区**：加"目录"和"元数据源"两个 section 标题，目录管理与网络配置视觉分离。
- **通用 Tab 精简**：移除缓存管理（已迁移至数据 Tab），仅保留关闭窗口行为和语言设置。
- **数据 Tab 独立**：裁决数据、图片缓存、元数据重置等清理操作从媒体库和通用 Tab 迁移至独立的数据 Tab。
- **工具栏新增 NSIS 入口**：`C:\Tools\nsis` 路径加入用户 PATH，支持 `npx tauri build` 直接生成安装包。
