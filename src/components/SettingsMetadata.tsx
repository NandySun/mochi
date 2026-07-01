import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Series } from "../types";
import { BreathingDot } from "./BreathingDot";
import { sectionTitle, actionBtn, label } from "../styles/settings";

const TMDB_KEY = "mochi_tmdb_key";

export default function SettingsMetadata() {
  const [tmdbKey, setTmdbKey] = useState(
    () => localStorage.getItem(TMDB_KEY) ?? ""
  );
  const [showKey, setShowKey] = useState(false);

  const [batchStatus, setBatchStatus] = useState<string | null>(null);

  const saveTmdbKey = () => {
    localStorage.setItem(TMDB_KEY, tmdbKey);
  };

  const handleBatchFetch = async () => {
    setBatchStatus("准备中…");
    try {
      const all: Series[] = await invoke("get_all_series");
      for (let i = 0; i < all.length; i++) {
        setBatchStatus(`正在拉取 (${i + 1}/${all.length})…`);
        try {
          await invoke("fetch_metadata", {
            seriesId: all[i].id,
            tmdbApiKey: tmdbKey,
            force: true,
          });
          // Also pull cast + episode metadata
          try { await invoke("fetch_cast", { seriesId: all[i].id, tmdbApiKey: tmdbKey }); } catch {}
          try { await invoke("fetch_episode_metadata", { seriesId: all[i].id, tmdbApiKey: tmdbKey }); } catch {}
        } catch {
          /* skip failed */
        }
      }
      setBatchStatus("完成");
    } catch {
      setBatchStatus("获取列表失败");
    }
    window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    setTimeout(() => setBatchStatus(null), 3000);
  };

  return (
    <>
      <h2 style={sectionTitle}>元数据</h2>

      {/* TMDB Key */}
      <label style={label}>TMDB API Key</label>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <input
          type={showKey ? "text" : "password"}
          style={inputStyle}
          value={tmdbKey}
          onChange={(e) => setTmdbKey(e.target.value)}
          onBlur={saveTmdbKey}
          placeholder="输入 TMDB API Key"
        />
        <button style={eyeBtn} onClick={() => setShowKey((v) => !v)} tabIndex={-1}>
          {showKey ? "🙈" : "👁"}
        </button>
      </div>

      {/* batch fetch */}
      {batchStatus ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <BreathingDot size={24} />
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {batchStatus}
          </span>
        </div>
      ) : (
        <button style={actionBtn} onClick={handleBatchFetch}>
          批量拉取全部元数据
        </button>
      )}
    </>
  );
}

// ── local styles ────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  border: "1px solid var(--color-surface)",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text-secondary)",
};

const eyeBtn: React.CSSProperties = {
  position: "absolute",
  right: 10,
  top: "50%",
  transform: "translateY(-50%)",
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  padding: 0,
};
