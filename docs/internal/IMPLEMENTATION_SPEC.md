# Mochi Phase 2 · 前端实现规范

> 三份设计草图已确认：`06-mondrian-C` / `10-detail-final` / `13-player-rounded`
> 本文档是 CC (Claude Code) 编码依据。逐组件给出接口、IPC 调用、CSS 要点。

---

## 一、文件结构

```
src/
├── main.tsx                    # 入口，不变
├── App.tsx                     # 路由（需改）
├── index.css                   # 全局样式（需改：暖白底色、字体栈）
├── types/index.ts              # 已有 Phase 2 类型（不变）
├── hooks/
│   ├── useMpv.ts               # 新建：mpv 播放控制映射
│   └── useFullscreen.ts        # 新建：Tauri 窗口全屏
├── components/
│   ├── SideStrip.tsx           # 新建：左侧竖条导航（三页共用）
│   ├── PosterWall.tsx          # 重写：蒙德里安海报墙
│   ├── SeriesDetail.tsx        # 重写：横幅 + 浮动海报 + 剧集卡片
│   ├── VideoPlayer.tsx         # 重写：圆角内嵌播放 + 右侧栏
│   ├── OscBar.tsx              # 新建：播放器 OSC 控制条
│   ├── EpisodeList.tsx         # 新建：侧栏剧集列表
│   └── MetadataSidebar.tsx     # 新建：封面+简介+信息
```

---

## 二、全局样式 `index.css`

```css
/* 三页共用底色 */
body {
  font-family: -apple-system, "Noto Serif SC", Georgia, serif;
  background: #fefdfb;   /* 浏览页浅暖底 */
  color: #1a1a1a;
}
/* 播放页用自己的暗色：由 VideoPlayer 容器覆盖 */
```

播放页的 `#0f0f0e` 暗底在 VideoPlayer 组件自身的容器上设置，不污染浏览页。

---

## 三、路由 `App.tsx`

```tsx
import { Routes, Route } from "react-router-dom";
import PosterWall from "./components/PosterWall";
import SeriesDetail from "./components/SeriesDetail";
import VideoPlayer from "./components/VideoPlayer";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PosterWall />} />
      <Route path="/series/:id" element={<SeriesDetail />} />
      <Route path="/play/:episodeId" element={<VideoPlayer />} />
    </Routes>
  );
}
```

Phase 1 已有 React Router，路由结构不变。组件内部完全重写。

---

## 四、共享组件 `SideStrip.tsx`

**用途**：三页（海报墙、详情、播放器）共用的左侧 56px 竖条导航。

**Props**：
```ts
interface SideStripProps {
  activeIndex: 0 | 1 | 2;  // 哪个圆点高亮（0=媒体库 1=详情 2=播放器）
  onBack?: () => void;      // 返回按钮回调（媒体库页不传）
  variant?: "light" | "dark"; // 浏览页=light 播放页=dark
}
```

**CSS 映射（从草图）**：

| 属性 | light 值 | dark 值 |
|---|---|---|
| width | `56px` | `56px` |
| background | `#f0ece6` | `#161614` |
| border-right | `1px solid rgba(0,0,0,0.05)` | `1px solid rgba(255,255,255,0.04)` |
| logo 颜色 | `#1a1a1a` | `rgba(255,255,255,0.18)` |
| 圆点（inactive） | `#ccc` | `rgba(255,255,255,0.08)` |
| 圆点（active） | `#1a1a1a` 6px | `rgba(255,255,255,0.35)` 6px |
| 返回按钮 | 18px 色 `#888` | 32px 正圆 `rgba(255,255,255,0.04)` 底色 |

**行为**：
- 点击 logo → `navigate("/")`
- 点击返回按钮 → 调用 `onBack`（通常 `navigate(-1)`）
- 圆点不可点击（纯状态指示）

**Tailwind + 少量自定义 CSS 实现策略**：用 Tailwind 处理宽高和 flex，variant 颜色用 `data-variant` 属性 + CSS 变量，或直接用条件 className。

---

## 五、海报墙 `PosterWall.tsx`

### 5.1 布局结构

```
┌──────┬──────────────────────────────┐
│      │  MEDIA LIBRARY    全部 动漫 影视 │
│ Side │ ┌────────┬────┬────┬────────┐ │
│Strip │ │ 黄泉   │ 上 │ 太 │        │ │
│      │ │ 使者   │ 伊 │ 阳 │  (空)  │ │
│      │ │ (2×2)  │ 那 │ 星 │        │ │
│      │ │        │ 牡 │ 辰 │        │ │
│      │ │        │ 丹 │    ├────────┤ │
│      │ ├────────┤    │    │        │ │
│      │ │        │    │    │  (空)  │ │
│      │ │ (空)   ├────┴────┤        │ │
│      │ │        │  (空)   │        │ │
│      │ └────────┴─────────┴────────┘ │
└──────┴──────────────────────────────┘
```

### 5.2 CSS Grid 定义

```css
.mondrian-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 2fr;
  grid-auto-rows: 200px;
  gap: 16px;
  padding: 40px 48px;
}
```

每个 item 的 grid 位置通过 props 或内联 style 指定：

```
黄泉使者: grid-column: 1/2; grid-row: 1/3   (2×2 英雄位)
上伊那:   grid-column: 2/3; grid-row: 1/2   (1×1)
太阳星辰: grid-column: 3/4; grid-row: 1/3   (1×2)
空槽4:    grid-column: 4/5; grid-row: 1/2   (1×1)
空槽5:    grid-column: 1/2; grid-row: 3/4   (1×1)
空槽6:    grid-column: 2/4; grid-row: 2/4   (2×2)
空槽7:    grid-column: 4/5; grid-row: 2/4   (1×2)
```

但系列数量是可变的，所以不能写死。**做法**：维护一个 grid 布局模板数组，根据实际系列数量动态分配。3 个系列对应 3 个填充区 + 4 个空区。系列数量变化时需要换一套模板。

**Phase 2 简化方案**：先用一个灵活的 masonry 式 grid（非写死 grid-area），每张海报 aspect-ratio 随机变化（2/3 或 1/1 或 3/4），用 `grid-row: span 2` / `span 1` 制造不规则感。`auto-fill` + `dense` 自动填充。

```css
.mondrian-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  grid-auto-rows: 160px;
  gap: 16px;
  grid-auto-flow: dense;
}
.poster-card { position: relative; overflow: hidden; border: 1px solid rgba(0,0,0,0.06); }
.poster-card.span-2 { grid-row: span 2; }
.poster-card.span-3 { grid-row: span 3; }
```

第一张卡片（黄泉使者）给 `span-3`（占 3 行），第二张（上伊那）给 `span-1`，第三张（太阳星辰）给 `span-2`，空槽给 `span-1` 或 `span-2`。

### 5.3 卡片内部结构

```
┌──────────────────┐
│ gradient 背景    │
│                  │
│     黄          │  ← 大字白色半透明
│                  │
│ ┌──────────────┐ │
│ │ 黄泉使者      │ │  ← 底部渐隐信息条
│ │ 动漫·24集·7.8 │ │
│ └──────────────┘ │
└──────────────────┘
```

- 背景：纯色渐变（每系列不同颜色，从 series.id 派生色相）
- 大字：首字，`font-size: 64px; font-weight: 700; color: rgba(255,255,255,0.15)`
- 信息条：`position: absolute; bottom: 0;` 渐变透明底，标题 + 副标题
- 如果 `series.poster_path` 存在 → 用 `convertFileSrc(poster_path)` 设为背景图
- hover → `transform: scale(1.02)` + `z-index: 2`
- 空槽：浅灰背景 `#f5f2ed`，无大字无信息条，虚线边框可选

### 5.4 IPC 调用

```ts
// 组件挂载时
const seriesList = await invoke<Series[]>("get_all_series");
const cacheDir = await invoke<string>("get_cache_dir");
// 用 convertFileSrc 转换每个 series.poster_path
```

### 5.5 顶部栏

```
MEDIA LIBRARY          全部  动漫  影视
```

- 顶部行：flex, justify-between
- 左侧 "MEDIA LIBRARY" → `font-size: 11px; font-weight: 600; color: #bbb; text-transform: uppercase; letter-spacing: 2px`
- 右侧筛选 pills：当前激活项 `color: #1a1a1a`，其余 `color: #ccc`
- 筛选逻辑：纯前端 filter `series.type`

---

## 六、系列详情 `SeriesDetail.tsx`

### 6.1 布局结构

```
┌──────┬──────────────────────────────┐
│ Side │ ┌──────────────────────────┐ │
│Strip │ │  hero banner             │ │
│      │ │                    [返回] │ │
│      │ │  ┌────┐                   │ │
│      │ │  │海报│  黄泉使者          │ │
│      │ │  │170 │  2024·24集·★7.8   │ │
│      │ │  └────┘                   │ │
│      │ ├──────────────────────────┤ │
│      │ │  动作  奇幻  冒险         │ │
│      │ │  简介段落…                │ │
│      │ │                          │ │
│      │ │  第 1 季                  │ │
│      │ │  ┌─────┐ ┌─────┐        │ │
│      │ │  │ E01 │ │ E02 │        │ │
│      │ │  │ ✓   │ │ ▷60%│        │ │
│      │ │  └─────┘ └─────┘        │ │
│      │ │  ...                     │ │
└──────┴──────────────────────────────┘
```

### 6.2 Hero Banner

```css
.hero {
  height: 320px;
  background: linear-gradient(135deg, #1a2a3a, #2a3a50, #3d5a78);
  /* 如果有 fanart_path → background-image: url(convertFileSrc(...)) */
}
.hero-overlay {
  background: linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0.1) 40%, transparent 70%);
}
```

- 系列名：`font-size: 34px; font-weight: 700; color: #fff`
- 元数据行：`14px; color: rgba(255,255,255,0.7)`
- 浮动海报：`width: 170px; aspect-ratio: 2/3; left: 48px; bottom: -24px; border-radius: 6px; box-shadow: 0 12px 36px rgba(0,0,0,0.3)`
- 浮动海报在一半 banner 内、一半溢出到内容区

### 6.3 内容区

- `padding: 48px 48px 72px; margin-left: 190px`（给浮动海报留空间）
- 类型标签：`padding: 4px 14px; border-radius: 12px; background: #f0ece6; color: #777; font-size: 12px`
- 简介：`font-size: 14px; line-height: 1.9; color: #666; max-width: 620px`
- 季标签：`font-size: 11px; font-weight: 600; color: #bbb; text-transform: uppercase; letter-spacing: 2px`

### 6.4 剧集卡片

双列 grid `repeat(auto-fill, minmax(280px, 1fr))`，gap 10px。

单卡结构（flex 行）：
```
[编号 20px bold] [标题 14px + CC标签 + 时长 11px] [状态图标]
```

状态图标：
- ✓ 已看 → `color: #4a8`
- ▷ 观看中 → `color: #c47e3a`，下方 2px 进度条
- ○ 未看 → `color: #ddd`
- ⏳ 下载中 → 整卡 `opacity: 0.5`

卡片：`border: 1px solid #e8e4de; border-radius: 6px; background: #fff; padding: 14px 18px`
hover：`border-color: #c5bdb2; box-shadow: 0 2px 8px rgba(0,0,0,0.04)`

进度条：`height: 2px; background: #eee; border-radius: 1px`，填充 `background: #c47e3a`，宽度百分比。

### 6.5 IPC 调用

```ts
const series = await invoke<Series>("get_series_by_id", { id: Number(id) });
const episodes = await invoke<Episode[]>("get_episodes_by_series", { seriesId: Number(id) });
```

`genres` 字段是 JSON 字符串，前端 `JSON.parse()` 后渲染标签。

---

## 七、播放器 `VideoPlayer.tsx`

### 7.1 布局结构

```
┌──────┬───────────────────────┬──────────────┐
│ Side │  [←返回]      [全屏⛶] │  [封面 96px] │
│Strip │                       │  黄泉使者     │
│(dark)│   ┌───────────────┐   │  2024·动漫   │
│      │   │               │   │  7.8 AniList │
│      │   │   libmpv      │   │  ─────────── │
│      │   │   渲染区       │   │  简介段落…   │
│      │   │   (圆角16px)  │   │  ─────────── │
│      │   │               │   │  剧集 | 详情  │
│      │   │ ┌───────────┐ │   │  E01 ✓      │
│      │   │ │ OSC 胶囊  │ │   │  E02 ▷ ←    │
│      │   │ └───────────┘ │   │  E03 ○      │
│      │   └───────────────┘   │  ...         │
└──────┴───────────────────────┴──────────────┘
```

### 7.2 VideoPanel（左侧视频区）

```css
.video-panel {
  padding: 12px; /* 让视频区圆角露出来 */
}
.video-area {
  border-radius: 16px;
  overflow: hidden;
  background: #0a0a09;
}
```

- 视频区内是 mpv 透明窗口嵌入层。Phase 1 的嵌入方案不变。
- 浮动按钮：36px 正圆，`background: rgba(0,0,0,0.3); backdrop-filter: blur(8px)`
  - 返回：左上 `top: 16px; left: 16px`
  - 全屏：右上 `top: 16px; right: 16px`

### 7.3 OSC 控制条 `OscBar.tsx`

组件位于视频区底部，绝对定位。结构：

```
[08:24] ───●───────── [24:10]
⏮  ▶  ⏭  ●E02·多磨屋的早晨        1.0×  🔊  ⚙
```

- 进度条：`height: 4px; background: rgba(255,255,255,0.1); border-radius: 4px`
- 已播放段：`background: rgba(255,255,255,0.5)`
- 拖拽点：`14px` 白圆，`box-shadow: 0 1px 4px rgba(0,0,0,0.3)`
- 所有按钮：**胶囊形** (capsule/pill)。非播放按钮 `34px` 高 `border-radius: 17px`，`background: rgba(255,255,255,0.06)`。播放键 `40px` 正圆 `border-radius: 50%`。
- 当前播放信息：`font-size: 12px; color: rgba(255,255,255,0.35)`，前缀一个 `5px` 琥珀色圆点

**OSC 行为**：
- 进度条点击 → `seek <秒> absolute`
- 进度条拖动 → 同上
- ⏮ → `navigate(/play/${prevEpisodeId})`
- ▶ → `cyclePause()`（toggle 播放/暂停）
- ⏭ → `navigate(/play/${nextEpisodeId})`
- 1.0× → 循环切换 `[1.0, 1.25, 1.5, 2.0]`
- 🔊 → 音量滑块弹出或静音 toggle
- ⚙ → 设置弹出（音轨/字幕/播放速度 — Phase 3 实现，Phase 2 只放按钮）

### 7.4 右侧栏

`width: 340px; background: #131311; border-left: 1px solid rgba(255,255,255,0.04)`

**封面区**（固定顶部）：
- 海报：`96px` × `2/3` ratio，`border-radius: 10px`，渐变背景（从 series 颜色派生）
- 标题：`16px; font-weight: 600; color: rgba(255,255,255,0.8)`
- 元数据：`11px; color: rgba(255,255,255,0.28)`
- 评分：`22px; font-weight: 700; color: #c47e3a`（琥珀色强调）
- 评分来源标注：`10px; color: rgba(255,255,255,0.18)`
- 简介段落：`12px; line-height: 1.9; color: rgba(255,255,255,0.35)`

**Tab 切换**：
- 剧集 / 详情 两个 tab
- 激活：`color: rgba(255,255,255,0.6)`；非激活：`color: rgba(255,255,255,0.2)`
- 无下划线、无背景——纯文字明度区分（极简）

**剧集列表**（`EpisodeList.tsx`）：

```tsx
interface EpisodeListProps {
  episodes: Episode[];
  currentEpisodeId: number;
  onSelect: (episodeId: number) => void;
}
```

- 每项：`padding: 9px 20px; margin: 2px 12px; border-radius: 10px`
- 当前播放项：`background: rgba(255,255,255,0.04)`
- 编号：`11px; color: rgba(255,255,255,0.2)` 右对齐
- 标题：`13px; color: rgba(255,255,255,0.5)` 单行省略
- 时长/CC：`10px; color: rgba(255,255,255,0.18)`
- 状态圆点：6px，已看 `#5a9` / 观看中 `#c47e3a` / 未看 `rgba(255,255,255,0.06)`

**详情 tab 内容**（`MetadataSidebar.tsx`）：

```
当前剧集
  文件    黄泉使者_E02.mkv
  时长    24:10
  字幕    外挂 ASS
```

- 标签：`10px; font-weight: 600; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 1.5px`
- 键值行：`11px; key: rgba(255,255,255,0.2); val: rgba(255,255,255,0.4)`

### 7.5 全屏逻辑 `useFullscreen.ts`

```ts
import { invoke } from "@tauri-apps/api/core";

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggle = async () => {
    const next = !isFullscreen;
    await invoke("set_fullscreen", { fullscreen: next });
    setIsFullscreen(next);
  };

  return { isFullscreen, toggle };
}
```

全屏时前端行为：
- 右侧栏 `display: none`
- 视频区 padding 归零，圆角归零（全屏不需要圆角间隙）
- OSC 仍显示，鼠标 idle 后淡出

### 7.6 IPC 调用

```ts
// 挂载时加载数据
const episode = await invoke<Episode>("get_episode_by_id", { id: episodeId });
const series = await invoke<Series>("get_series_by_id", { id: episode.series_id });
const episodes = await invoke<Episode[]>("get_episodes_by_series", { seriesId: episode.series_id });
const filePath = await invoke<string>("get_episode_path", { episodeId });

// 播放进度上报（每 5 秒或暂停时）
await invoke("update_watch_progress", { episodeId, progressSecs: Math.floor(timePos) });

// 全屏
await invoke("set_fullscreen", { fullscreen: true });
```

---

## 八、`useMpv` Hook

```ts
// hooks/useMpv.ts
import { useEffect, useState, useRef, useCallback } from "react";

// tauri-plugin-libmpv-api 提供的全局 Mpv 对象
declare const Mpv: {
  cyclePause(): Promise<void>;
  command(cmd: string): Promise<void>;
  setProperty(name: string, value: unknown): Promise<void>;
  getProperty<T = unknown>(name: string): Promise<T | null>;
};

export function useMpv() {
  const [timePos, setTimePos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1.0);
  const animRef = useRef<number>(0);

  // 60fps 轮询时间位置
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const pos = await Mpv.getProperty<number>("time-pos");
        const dur = await Mpv.getProperty<number>("duration");
        const p = await Mpv.getProperty<boolean>("pause");
        if (pos != null) setTimePos(pos);
        if (dur != null) setDuration(dur);
        if (p != null) setPaused(p);
      } catch { /* mpv 未就绪时静默 */ }
      animRef.current = requestAnimationFrame(poll);
    };
    poll();
    return () => { active = false; cancelAnimationFrame(animRef.current); };
  }, []);

  const togglePlay = useCallback(() => Mpv.cyclePause(), []);
  const seek = useCallback((sec: number) => {
    Mpv.command(`seek ${sec} absolute`);
  }, []);
  const setVol = useCallback((v: number) => {
    Mpv.setProperty("volume", v);
    setVolume(v);
  }, []);
  const cycleSpeed = useCallback(() => {
    const next = speed >= 2.0 ? 1.0 : speed + 0.25;
    Mpv.setProperty("speed", next);
    setSpeed(next);
  }, [speed]);

  return { timePos, duration, paused, volume, speed, togglePlay, seek, setVol, cycleSpeed };
}
```

**注意**：`tauri-plugin-libmpv-api` 的实际导入路径取决于插件版本。Phase 1 已经能正常调用 `cyclePause`，所以具体的 import 方式沿用 Phase 1 的调用模式。上面的 `declare const Mpv` 是示意——实际应沿用 Phase 1 已有的 import。

---

## 九、颜色常量

| 用途 | 色值 |
|---|---|
| 浏览页底色 | `#fefdfb` |
| 浏览页浅暖灰 | `#faf8f5` |
| 侧边条（light） | `#f0ece6` |
| 深色渐变（hero/海报） | `#1a2a3a` → `#2a4058` → `#3d5a78` |
| 卡片边框 | `#e8e4de` |
| 类型标签底 | `#f0ece6` |
| 已看绿 | `#4a8` / `#5a9` |
| 观看中琥珀 | `#c47e3a` |
| 播放页底色 | `#0f0f0e` |
| 播放页侧栏 | `#131311` |
| 播放页侧边条 dark | `#161614` |
| 文本主色（暗） | `rgba(255,255,255,0.5~0.8)` |
| 文本辅色（暗） | `rgba(255,255,255,0.18~0.35)` |

系列海报背景色从色板中轮换（可预设 6 色）：

```
#3a5070, #6b4e5e, #c47e3a, #4a6b5e, #8b5e4a, #5a4a6b
```

按 `series.id % 6` 取色。

---

## 十、实现顺序

1. **`SideStrip.tsx`** — 三页共用，先做
2. **`PosterWall.tsx`** — 蒙德里安 grid + 卡片 + 顶部筛选
3. **`SeriesDetail.tsx`** — hero + 浮动海报 + 剧集卡片
4. **`useMpv.ts`** + **`OscBar.tsx`** — mpv 映射 + 控制条
5. **`EpisodeList.tsx`** + **`MetadataSidebar.tsx`** — 右侧栏子组件
6. **`VideoPlayer.tsx`** — 组装播放器
7. **`useFullscreen.ts`** — 全屏 hook
8. **`App.tsx`** + **`index.css`** — 收尾

---

## 十一、删除 / 不保留的 Phase 1 组件

以下 Phase 1 组件完全替换，不再保留：

- `PosterGrid.tsx` → `PosterWall.tsx`
- `SeriesDetail.tsx` → 同名重写
- `VideoPlayer.tsx` → 同名重写

不要尝试"渐进迁移"——直接重写。保留 Phase 1 的 `tauri-plugin-libmpv` 调用方式，其余全部按本文档重建。

---

## 十二、要求

- 用 Tailwind CSS 处理布局、间距、颜色、圆角、字体。复杂渐变和 backdrop-filter 用自定义 CSS（组件级 `<style>` 或 CSS module）。
- 所有 IPC 调用用 `invoke()`，不使用 `fetch`。
- 图片路径：后端返回绝对路径 → 前端用 `@tauri-apps/api/core` 的 `convertFileSrc()` 转 URL。
- 不引入新依赖（React Router、Tailwind、tauri api 已足够）。
- **不做截帧缩略图**，不做自动播放。
- 完成所有 8 步后交付审查。
