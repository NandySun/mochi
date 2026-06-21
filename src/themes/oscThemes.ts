export interface OscTheme {
  id: string;
  name: string;
  description: string;

  // 色彩
  accent: string;
  playedBarColor: string;
  trackBg: string;
  buttonBg: string;
  buttonHoverBg: string;
  textPrimary: string;
  textSecondary: string;

  // 进度条
  trackHeight: number;
  knobSize: number;
  hoverExpand: boolean;

  // 布局
  layout: "spread" | "centered";

  // 显示控制
  showNowPlaying: boolean;
  showSpeedButton: boolean;
  showVolumeSlider: boolean;
  showEpisodeButton: boolean;

  // 视觉
  oscPadding: string;
  oscGradient: string;
  buttonRadius: string;
  fontFamily: string;
}

export const OSC_THEMES: Record<string, OscTheme> = {
  mochi: {
    id: "mochi",
    name: "Mochi",
    description: "暖金 accent，圆形按钮，宽松布局",
    accent: "#c47e3a",
    playedBarColor: "rgba(196,126,58,0.7)",
    trackBg: "rgba(255,255,255,0.1)",
    buttonBg: "rgba(255,255,255,0.06)",
    buttonHoverBg: "rgba(255,255,255,0.12)",
    textPrimary: "rgba(255,255,255,0.6)",
    textSecondary: "rgba(255,255,255,0.35)",
    trackHeight: 4,
    knobSize: 14,
    hoverExpand: false,
    layout: "spread",
    showNowPlaying: true,
    showSpeedButton: true,
    showVolumeSlider: true,
    showEpisodeButton: true,
    oscPadding: "80px 20px 24px",
    oscGradient: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)",
    buttonRadius: "50%",
    fontFamily: "inherit",
  },

  youtube: {
    id: "youtube",
    name: "YouTube",
    description: "红 accent，居中播放键，hover 进度条加粗",
    accent: "#ff0000",
    playedBarColor: "#ff0000",
    trackBg: "rgba(255,255,255,0.2)",
    buttonBg: "transparent",
    buttonHoverBg: "rgba(255,255,255,0.08)",
    textPrimary: "rgba(255,255,255,0.9)",
    textSecondary: "rgba(255,255,255,0.6)",
    trackHeight: 4,
    knobSize: 12,
    hoverExpand: true,
    layout: "centered",
    showNowPlaying: true,
    showSpeedButton: true,
    showVolumeSlider: true,
    showEpisodeButton: false,
    oscPadding: "40px 12px 12px",
    oscGradient: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)",
    buttonRadius: "50%",
    fontFamily: "inherit",
  },

  potplayer: {
    id: "potplayer",
    name: "PotPlayer",
    description: "蓝 accent，紧凑布局，小方形按钮，传统播放器味",
    accent: "#1e88e5",
    playedBarColor: "#1e88e5",
    trackBg: "rgba(255,255,255,0.15)",
    buttonBg: "rgba(255,255,255,0.06)",
    buttonHoverBg: "rgba(255,255,255,0.14)",
    textPrimary: "rgba(255,255,255,0.75)",
    textSecondary: "rgba(255,255,255,0.4)",
    trackHeight: 5,
    knobSize: 12,
    hoverExpand: false,
    layout: "spread",
    showNowPlaying: true,
    showSpeedButton: true,
    showVolumeSlider: true,
    showEpisodeButton: true,
    oscPadding: "60px 10px 10px",
    oscGradient: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)",
    buttonRadius: "4px",
    fontFamily: "inherit",
  },

  netflix: {
    id: "netflix",
    name: "Netflix",
    description: "白 accent，极度克制，隐藏倍速/音量滑块",
    accent: "#e5e5e5",
    playedBarColor: "#e50914",
    trackBg: "rgba(255,255,255,0.15)",
    buttonBg: "transparent",
    buttonHoverBg: "rgba(255,255,255,0.1)",
    textPrimary: "rgba(255,255,255,0.85)",
    textSecondary: "rgba(255,255,255,0.5)",
    trackHeight: 3,
    knobSize: 10,
    hoverExpand: false,
    layout: "centered",
    showNowPlaying: false,
    showSpeedButton: false,
    showVolumeSlider: false,
    showEpisodeButton: false,
    oscPadding: "60px 16px 16px",
    oscGradient: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)",
    buttonRadius: "50%",
    fontFamily: "inherit",
  },

  minimal: {
    id: "minimal",
    name: "极简",
    description: "灰白 accent，只留播放/进度/全屏，极度安静",
    accent: "rgba(255,255,255,0.5)",
    playedBarColor: "rgba(255,255,255,0.5)",
    trackBg: "rgba(255,255,255,0.06)",
    buttonBg: "transparent",
    buttonHoverBg: "rgba(255,255,255,0.06)",
    textPrimary: "rgba(255,255,255,0.5)",
    textSecondary: "rgba(255,255,255,0.2)",
    trackHeight: 2,
    knobSize: 8,
    hoverExpand: false,
    layout: "spread",
    showNowPlaying: false,
    showSpeedButton: false,
    showVolumeSlider: false,
    showEpisodeButton: false,
    oscPadding: "40px 12px 12px",
    oscGradient: "linear-gradient(to top, rgba(0,0,0,0.3) 0%, transparent 100%)",
    buttonRadius: "50%",
    fontFamily: "inherit",
  },
};

export function getTheme(id: string): OscTheme {
  return OSC_THEMES[id] ?? OSC_THEMES.mochi;
}

export const THEME_LIST = Object.values(OSC_THEMES);
