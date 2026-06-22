import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Series } from "../types";
import { BreathingDot } from "./BreathingDot";

const TMDB_KEY = "mochi_tmdb_key";
const PROXY_KEY = "mochi_proxy_url";
const DEFAULT_PROXY = "";

export default function SettingsMetadata() {
  const [tmdbKey, setTmdbKey] = useState(
    () => localStorage.getItem(TMDB_KEY) ?? ""
  );
  const [showKey, setShowKey] = useState(false);

  const [proxyUrl, setProxyUrl] = useState(
    () => localStorage.getItem(PROXY_KEY) ?? DEFAULT_PROXY
  );

  const [batchStatus, setBatchStatus] = useState<string | null>(null);

  const saveTmdbKey = () => {
    localStorage.setItem(TMDB_KEY, tmdbKey);
  };

  const saveProxyUrl = () => {
    localStorage.setItem(PROXY_KEY, proxyUrl);
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
            proxyUrl,
            force: true,
          });
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

      {/* proxy */}
      <label style={label}>代理地址</label>
      <input
        type="text"
        style={{ ...inputStyle, marginBottom: 16 }}
        value={proxyUrl}
        onChange={(e) => setProxyUrl(e.target.value)}
        onBlur={saveProxyUrl}
        placeholder="http://127.0.0.1:7890"
      />

      {/* batch fetch */}
      {batchStatus ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <BreathingDot size={24} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
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

// ── styles ──────────────────────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.3)",
  textTransform: "uppercase",
  letterSpacing: 2,
  marginBottom: 16,
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "rgba(255,255,255,0.45)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.7)",
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

const actionBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.6)",
  borderRadius: 8,
  padding: "6px 20px",
  fontSize: 12,
  border: "none",
  cursor: "pointer",
};
