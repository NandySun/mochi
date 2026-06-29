import { useState } from "react";
import { THEME_LIST } from "../themes/oscThemes";
import { sectionTitle, label } from "../styles/settings";

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
    </>
  );
}


