import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Series } from "../types";
import { THEME_LIST } from "../themes/oscThemes";

const ROOT_DIRS_KEY = "mochi_root_dirs";
const TMDB_KEY = "mochi_tmdb_key";
const PROXY_KEY = "mochi_proxy_url";
const DEFAULT_DIRS = ["D:\\Video"];
const DEFAULT_PROXY = "";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export default function Settings({ onClose }: { onClose: () => void }) {
  // ── entrance/exit animation ────────────────────────────────────────────────
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setAnimating(true));
  }, []);

  const handleClose = () => {
    setAnimating(false);
    setTimeout(onClose, 150);
  };

  // ── media library ────────────────────────────────────────────────────────────
  const [rootDirs, setRootDirs] = useState<string[]>(() =>
    loadJson(ROOT_DIRS_KEY, DEFAULT_DIRS)
  );
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const [scanning, setScanning] = useState(false);

  // ── metadata ─────────────────────────────────────────────────────────────────
  const [tmdbKey, setTmdbKey] = useState(
    () => localStorage.getItem(TMDB_KEY) ?? ""
  );
  const [showKey, setShowKey] = useState(false);

  const [proxyUrl, setProxyUrl] = useState(
    () => localStorage.getItem(PROXY_KEY) ?? DEFAULT_PROXY
  );

  const [batchStatus, setBatchStatus] = useState<string | null>(null);

  // ── osc theme ───────────────────────────────────────────────────────────────
  const [currentTheme, setCurrentTheme] = useState(
    () => localStorage.getItem("mochi_osc_theme") ?? "mochi"
  );

  // persist rootDirs on change
  useEffect(() => {
    localStorage.setItem(ROOT_DIRS_KEY, JSON.stringify(rootDirs));
  }, [rootDirs]);

  // ── handlers ─────────────────────────────────────────────────────────────────

  const removeDir = (i: number) => {
    setRootDirs((prev) => prev.filter((_, idx) => idx !== i));
  };

  const startAdd = async () => {
    // try native folder picker first
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true });
      if (typeof selected === "string" && selected) {
        setRootDirs((prev) => [...prev, selected]);
        return;
      }
    } catch {
      // plugin not available, fall back to text input
    }
    setAdding(true);
    setAddValue("");
    setTimeout(() => addInputRef.current?.focus(), 0);
  };

  const confirmAdd = () => {
    const trimmed = addValue.trim();
    if (trimmed) {
      setRootDirs((prev) => [...prev, trimmed]);
    }
    setAdding(false);
    setAddValue("");
  };

  const handleRescan = async () => {
    setScanning(true);
    for (const dir of rootDirs) {
      try {
        await invoke("scan_library", { rootPath: dir });
      } catch {
        /* skip failed */
      }
    }
    setScanning(false);
  };

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
    setTimeout(() => setBatchStatus(null), 3000);
  };

  // ── ESC key close ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── render ──────────────────────────────────────────────────────────

  return createPortal(
    <>
      {/* Overlay */}
      <div onClick={handleClose} style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        opacity: animating ? 1 : 0,
        transition: "opacity 0.15s ease",
      }} />
      {/* Card */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: animating ? "translate(-50%, -50%) scale(1)" : "translate(-50%, -50%) scale(0.96)",
        opacity: animating ? 1 : 0,
        transition: "opacity 0.15s ease, transform 0.15s ease",
        zIndex: 101,
        width: 600, maxHeight: "80vh",
        background: "rgba(14,14,14,0.95)", backdropFilter: "blur(16px)",
        borderRadius: 14, overflow: "hidden",
      }}>
        {/* Close button */}
        <button onClick={handleClose} style={{
          position: "absolute", top: 16, right: 16, zIndex: 102,
          width: 28, height: 28, borderRadius: "50%",
          background: "rgba(255,255,255,0.08)", border: "none",
          cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 14,
        }}>✕</button>
        {/* Scrollable content */}
        <div style={{ overflowY: "auto", maxHeight: "calc(80vh - 96px)", padding: 48 }}>
          {/* title */}
          <h1
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: "rgba(255,255,255,0.85)",
              marginBottom: 32,
            }}
          >
            设置
          </h1>

          {/* ── 媒体库 ─────────────────────────────────────────────────── */}
          <section style={{ padding: "24px 0" }}>
            <h2 style={sectionTitle}>媒体库</h2>

            {/* root dirs list */}
            {rootDirs.map((dir, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginBottom: 8,
                  gap: 8,
                }}
              >
                <span style={dirPath}>{dir}</span>
                <button
                  style={deleteBtn}
                  onMouseEnter={(e) =>
                    ((e.currentTarget.style.color = "#e81123"))
                  }
                  onMouseLeave={(e) => ((e.currentTarget.style.color = "rgba(255,255,255,0.3)"))}
                  onClick={() => removeDir(i)}
                >
                  ✕
                </button>
              </div>
            ))}

            {/* adding new dir */}
            {adding && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginBottom: 8,
                  gap: 8,
                }}
              >
                <input
                  ref={addInputRef}
                  style={{ ...dirPath, outline: "none", border: "none" }}
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmAdd();
                    if (e.key === "Escape") {
                      setAdding(false);
                      setAddValue("");
                    }
                  }}
                  onBlur={confirmAdd}
                  placeholder="输入路径后按 Enter 确认"
                />
                <button
                  style={deleteBtn}
                  onMouseEnter={(e) =>
                    ((e.currentTarget.style.color = "#4caf50"))
                  }
                  onMouseLeave={(e) => ((e.currentTarget.style.color = "rgba(255,255,255,0.3)"))}
                  onClick={confirmAdd}
                >
                  ✓
                </button>
              </div>
            )}

            <button style={textBtn} onClick={startAdd}>
              ＋ 添加文件夹
            </button>

            {/* rescan */}
            <button
              style={{ ...actionBtn, marginTop: 16 }}
              disabled={scanning}
              onClick={handleRescan}
            >
              {scanning ? "扫描中…" : "重新扫描"}
            </button>
          </section>

          {/* ── 元数据 ─────────────────────────────────────────────────── */}
          <section style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "24px 0" }}>
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
              <button
                style={eyeBtn}
                onClick={() => setShowKey((v) => !v)}
                tabIndex={-1}
              >
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
            <button style={actionBtn} disabled={!!batchStatus} onClick={handleBatchFetch}>
              批量拉取全部元数据
            </button>
            {batchStatus && (
              <span style={{ marginLeft: 12, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                {batchStatus}
              </span>
            )}
          </section>

          {/* ── 播放器主题 ──────────────────────────────────────────── */}
          <section style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "24px 0" }}>
            <h2 style={sectionTitle}>播放器主题</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {THEME_LIST.map((t) => {
                const isActive = currentTheme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setCurrentTheme(t.id); localStorage.setItem("mochi_osc_theme", t.id); window.dispatchEvent(new Event("mochi-theme-changed")); }}
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
          </section>

          {/* ── 关于 ───────────────────────────────────────────────────── */}
          <section style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "24px 0" }}>
            <h2 style={sectionTitle}>关于</h2>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", margin: 0 }}>
              Mochi v0.1.0
            </p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", margin: "4px 0 0" }}>
              Tauri v2 · React 19 · libmpv
            </p>
          </section>
        </div>
      </div>
    </>,
    document.body
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

const dirPath: React.CSSProperties = {
  flex: 1,
  fontSize: 13,
  color: "rgba(255,255,255,0.5)",
  background: "rgba(255,255,255,0.06)",
  borderRadius: 6,
  padding: "8px 14px",
};

const deleteBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.3)",
  fontSize: 14,
  cursor: "pointer",
  padding: "0 4px",
};

const textBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.4)",
  fontSize: 13,
  cursor: "pointer",
  padding: "4px 0",
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
