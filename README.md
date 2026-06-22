# Mochi

**桌面原生个人多媒体库。海报即导航，点开就看。**

![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-0.1.4-c47e3a)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Tauri](https://img.shields.io/badge/Tauri-v2-ffc131)

---

## 预览

![海报墙](screenshots/home.png)

![详情页](screenshots/detail.png)

![播放页](screenshots/player.png)

Mochi 是本地视频的影库前端。指定文件夹，自动扫描并按系列分组；
从 Bangumi / TMDB 拉取元数据（海报、简介、评分）；内置 mpv 播放器，
Everything in one window。

---

## 功能

- **📀 零约束入库** — 指定任意文件夹，递归扫描，自动分组。无需特定目录结构
- **🎬 海报墙** — 响应式横滚海报，键盘/滚轮导航，选中系列实时预览 fanart 背景
- **📋 系列详情** — fanart 全屏背景、海报、简介、剧集网格，⋮ 菜单刷新元数据
- **▶️ 内置播放器** — mpv 内核，透明窗口视频透底，OSC 控制条 + 选集面板
- **🎨 五种 OSC 主题** — Mochi / YouTube / PotPlayer / Netflix / 极简，设置中一键切换
- **⏯️ 自动连播** — 剧集末尾自动跳转下一集，进度实时保存
- **💾 进度记忆** — 每 10 秒自动保存，关闭不丢失，首页「继续」一键续播
- **🔍 元数据双搜** — 动漫 Bangumi（免费无需 Key），影视 TMDB，离线缓存到磁盘
- **🖥️ 桌面原生** — Tauri v2 应用，自定义标题栏，系统托盘，窗口位置记忆
- **⚙️ 灵活设置** — 根目录管理、关闭行为（托盘/退出）、OSC 主题、缓存管理
- **📦 双轨分发** — NSIS 安装版 + 便携版 zip，同一代码产出，`.portable` 标记切换数据路径

---

## 安装

从 [Releases](../../releases) 下载：

| 版本 | 文件名 | 说明 |
|---|---|---|
| 安装版 | `Mochi_0.1.4_x64-setup.exe` | NSIS 安装器，数据存 `%APPDATA%/mochi/` |
| 便携版 | `mochi-v0.1.4-portable.zip` | 解压即用，数据存 exe 同级目录 |

便携版通过 exe 旁 `.portable` 标记文件自动切换数据路径，无需配置。

### 从源码构建

**前置依赖**：
- [Node.js](https://nodejs.org/) 18+（推荐 20 LTS）
- [Rust](https://rustup.rs/) 工具链（stable-x86_64-pc-windows-msvc）
- [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 或 Visual Studio 2022 Build Tools

```bash
git clone https://github.com/NandySun/mochi.git
cd mochi
npm install
npx tauri dev                        # 开发模式
pnpm tauri build                     # 生产构建 + NSIS 安装器
pnpm tauri build --bundles nsis      # 仅 NSIS
.\scripts\package-portable.ps1       # 打包便携版 zip（需先 build）
```

---

## 目录结构

Mochi 扫描你指定的任意文件夹，**不强求特定目录结构**。它会递归寻找视频文件，按子文件夹自动分组为系列。

类型识别按优先级依次尝试：

1. **`.mochi` 裁决文件** — 系列文件夹下手动指定的类型记录
2. **文件夹名后缀** — 如 `黄泉使者 [tv]`、`葬送的芙莉莲 [anime]`
3. **父文件夹名** — 如放在 `anime/`、`tv/`、`movie/` 下自动继承类型
4. **无匹配 → unknown** — 可在详情页手动指定

最简单的用法：把所有视频按系列分文件夹，直接指向根目录扫描即可。

```
我的视频/
├── 葬送的芙莉莲/          ← 无后缀，无父文件夹 hint → unknown，可手动指定
│   ├── E01.mkv
│   └── poster.jpg
├── 太阳星辰 [tv]/        ← 后缀 [tv] → type=tv
│   ├── E01.mkv
│   └── poster.jpg
└── 你的名字 [movie]/      ← 后缀 [movie] → type=movie
    └── 你的名字.mkv
```

如果习惯分类管理，也可以用传统结构（`anime/`、`tv/`、`movie/` 顶层文件夹），Mochi 会自动识别。

> **poster.jpg**：在每个系列文件夹放置一张海报图，Mochi 会优先使用。未放置则从 Bangumi / TMDB 自动拉取。

---

## 快速上手

1. 启动 Mochi，点击 ⚙ → 设置 → 媒体库 → 添加根目录
2. 点击「重新扫描」
3. 设置 → 元数据 → （可选）填入 TMDB API Key → 批量拉取全部元数据
4. 回到首页，开始浏览

> **TMDB API Key** 免费注册：https://www.themoviedb.org/settings/api  
> 仅影视需要。动漫通过 Bangumi 自动拉取，无需任何 Key。  
> 国内网络访问 `api.bgm.tv` 可能需要代理（Bangumi 源站偶发 502）。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Tauri v2 |
| 前端 | React 19 + TypeScript + Tailwind CSS |
| 动画 | framer-motion 11 |
| 数据 | SQLite（rusqlite + bundled） |
| 播放 | libmpv + tauri-plugin-libmpv |
| 元数据 | Bangumi + TMDB 双搜 |

---

## 设计

Mochi 的交互遵循**材质物理三定律**：形变可逆、运动有质量、温度是信息。所有动画（入场交错、按压 squish、滚动粘度、背景 crossfade）由 framer-motion 驱动，追求桌面应用中的「粘糯感」。

OSC 控制条 5 种内置主题，`src/themes/oscThemes.ts` 中新增一个对象即可扩展。元数据刷新期间 ⋮ 菜单按钮变为呼吸圆（唯一加载态符号），不再使用传统 spinner。

菜单项使用 Unicode 符号（⌘ ✓ ⋯ 等）而非 emoji，在正文中保持一致的视觉重量。

---

## 已知限制

- **Windows only**（macOS 计划中）
- 音轨/字幕切换中 `track-list` 部分功能不可用（libmpv-wrapper v0.1.1 + libmpv-2 v0.41.0 兼容性）
- 不内置 ffmpeg，视频元数据（时长、编码信息）显示受限
- 暂不支持自动截帧缩略图，封面优先使用 Bangumi / TMDB 远程图片
- 首次扫描超大目录时 UI 可能短暂无响应（扫描在 Rust 侧异步执行，已做基本优化）
- `api.bgm.tv` 在国内网络环境下不可达（需代理，且源站可能间歇 502）

---

## 许可证

Mochi 本体使用 [MIT License](LICENSE)。

本应用动态链接 [libmpv](https://github.com/mpv-player/mpv)（LGPL v2.1+），
libmpv 二进制随便携版分发。LGPL 要求提供库源码获取方式：
https://github.com/mpv-player/mpv

---

## 致谢

- [mpv](https://mpv.io/) — 出色的开源播放器
- [Tauri](https://tauri.app/) — 轻量桌面应用框架
- [Bangumi](https://bangumi.tv/) — 中文动画数据库
- [TMDB](https://www.themoviedb.org/) — 影视元数据
- [framer-motion](https://www.framer.com/motion/) — React 动画库
