import { useState } from "react";
import { THEME_LIST } from "../themes/oscThemes";
import { sectionTitle, label } from "../styles/settings";

const SHORTCUTS: [string, string][] = [
  ["Space", "播放/暂停"],
  ["← / →", "后退/前进 5 秒"],
  ["↑ / ↓", "音量 +/- 5"],
  ["F", "全屏切换"],
  ["Esc", "关闭浮层 / 退出全屏 / 返回"],
  ["M", "静音切换"],
  ["[ / ]", "减速/加速"],
  ["P / N", "上一集/下一集"],
];

export default function SettingsPlayback() {
  // ── OSC theme ──────────────────────────────────────────────────────────────
  const [currentTheme, setCurrentTheme] = useState(
    () => localStorage.getItem("mochi_osc_theme") ?? "mochi"
  );

  const selectTheme = (id: string) => {
    setCurrentTheme(id);
    localStorage.setItem("mochi_osc_theme", id);
    window.dispatchEvent(new Event("mochi-theme-changed"));
  };

  return (
    <>
      <h2 style={sectionTitle}>播放</h2>

      {/* ── OSC Theme ──────────────────────────────────────────────── */}
      <label style={label}>播放器主题</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 28 }}>
        {THEME_LIST.map((t) => {
          const isActive = currentTheme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => selectTheme(t.id)}
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                border: isActive ? `1.5px solid ${t.accent}` : "1px solid rgba(255,255,255,0.1)",
                background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                color: isActive ? t.accent : "rgba(255,255,255,0.4)",
                cursor: "pointer",
                minWidth: 100,
                textAlign: "center" as const,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{t.name}</div>
              <div style={{ fontSize: 10, opacity: 0.6 }}>{t.description}</div>
            </button>
          );
        })}
      </div>

      {/* ── 快捷键参考 ──────────────────────────────────────────── */}
      <label style={label}>快捷键参考</label>
      <div
        style={{
          padding: "16px 20px",
          borderRadius: 12,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <kbd style={kbdStyle}>{key}</kbd>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  minWidth: 36,
  textAlign: "center",
  padding: "3px 10px",
  borderRadius: 5,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.6)",
  fontSize: 11,
  fontFamily: "inherit",
  lineHeight: 1.4,
  whiteSpace: "nowrap" as const,
};


