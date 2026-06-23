import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sectionTitle, actionBtn, label } from "../styles/settings";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type CloseBehavior = "tray" | "exit";

const BEHAVIOR_OPTIONS: { value: CloseBehavior; label: string }[] = [
  { value: "tray", label: "最小化到系统托盘" },
  { value: "exit", label: "彻底退出程序" },
];

export default function SettingsGeneral() {
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  const loadCacheSize = useCallback(async () => {
    try {
      const size = await invoke<number>("get_cache_size");
      setCacheSize(size);
    } catch {
      setCacheSize(null);
    }
  }, []);

  useEffect(() => { loadCacheSize(); }, [loadCacheSize]);

  const handleClearCache = async () => {
    setClearing(true);
    setCleared(false);
    try {
      await invoke("clear_cache");
      setCleared(true);
      await loadCacheSize();
      setTimeout(() => setCleared(false), 2000);
    } catch (e) {
      console.error("Failed to clear cache:", e);
    }
    setClearing(false);
  };

  // ── close behavior ─────────────────────────────────────────────────────────
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>("tray");
  const [behaviorLoaded, setBehaviorLoaded] = useState(false);

  useEffect(() => {
    if (behaviorLoaded) return;
    setBehaviorLoaded(true);
    invoke<string>("get_close_behavior").then((v) => {
      if (v === "tray" || v === "exit") setCloseBehavior(v);
    }).catch(() => {});
  }, [behaviorLoaded]);

  const handleChangeBehavior = async (behavior: CloseBehavior) => {
    setCloseBehavior(behavior);
    try {
      await invoke("set_close_behavior", { behavior });
    } catch {
      /* revert on error */
    }
  };

  return (
    <>
      <h2 style={sectionTitle}>通用</h2>

      {/* ── Close Behavior ─────────────────────────────────────────── */}
      <label style={label}>关闭窗口行为</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {BEHAVIOR_OPTIONS.map((opt) => {
          const isActive = closeBehavior === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => handleChangeBehavior(opt.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 8,
                border: isActive ? "1px solid rgba(196,126,58,0.5)" : "1px solid rgba(255,255,255,0.08)",
                background: isActive ? "rgba(196,126,58,0.08)" : "transparent",
                cursor: "pointer",
                textAlign: "left" as const,
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: isActive ? "5px solid #c47e3a" : "2px solid rgba(255,255,255,0.2)",
                  flexShrink: 0,
                  boxSizing: "border-box",
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  color: isActive ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)",
                }}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── 缓存管理 ─────────────────────────────────────────────── */}
      <label style={label}>缓存管理</label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <button
          style={{
            ...actionBtn,
            opacity: clearing ? 0.5 : 1,
            cursor: clearing ? "default" : "pointer",
          }}
          disabled={clearing}
          onClick={handleClearCache}
        >
          {cleared ? "已清除 ✓" : clearing ? "清除中…" : "清除缓存"}
        </button>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
          {cacheSize !== null ? `当前缓存：${formatBytes(cacheSize)}` : "正在读取…"}
        </span>
      </div>

      {/* ── 语言（预留占位） ────────────────────────────────────────── */}
      <label style={label}>语言</label>
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <p style={placeholder}>简体中文（默认） — 多语言支持规划中</p>
      </div>
    </>
  );
}

// ── local styles ────────────────────────────────────────────────────────────────

const placeholder: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.2)",
  margin: 0,
};
