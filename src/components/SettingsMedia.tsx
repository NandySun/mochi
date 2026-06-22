import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import type { SeriesScan } from "../types";
import { spring } from "../animations/tokens";
import { BreathingDot } from "./BreathingDot";

const ROOT_DIRS_KEY = "mochi_root_dirs";
const AMBIGUOUS_KEY = "mochi_ambiguous_series";
const DEFAULT_DIRS = ["D:\Video"];

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export default function SettingsMedia() {
  const [rootDirs, setRootDirs] = useState<string[]>(() =>
    loadJson(ROOT_DIRS_KEY, DEFAULT_DIRS)
  );
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const [scanning, setScanning] = useState(false);
  const [scanPath, setScanPath] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [clearVerdictStatus, setClearVerdictStatus] = useState<string | null>(null);

  // ── Confirm modal state ──────────────────────────────────────────────────
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    onConfirm: () => void;
  } | null>(null);

  const showConfirm = (title: string, onConfirm: () => void) => {
    setConfirmModal({ title, onConfirm });
  };

  useEffect(() => {
    localStorage.setItem(ROOT_DIRS_KEY, JSON.stringify(rootDirs));
  }, [rootDirs]);

  const removeDir = (i: number) => {
    setRootDirs((prev) => prev.filter((_, idx) => idx !== i));
  };

  const startAdd = async () => {
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

  const handleRescan = () => {
    showConfirm("重新扫描将覆盖现有扫描结果，确定继续吗？", async () => {
      setScanning(true);
      setScanCount(0);
      let totalCount = 0;
      let allAmbiguous: SeriesScan[] = [];
      for (const dir of rootDirs) {
        setScanPath(dir);
        try {
          const result = await invoke<{ series: { folder_name: string }[]; ambiguous: SeriesScan[] }>("scan_library", { rootPath: dir });
          totalCount += result.series.length;
          setScanCount(totalCount);
          if (result.ambiguous && result.ambiguous.length > 0) {
            allAmbiguous = allAmbiguous.concat(result.ambiguous);
          }
        } catch {
          /* skip failed */
        }
      }
      if (allAmbiguous.length > 0) {
        localStorage.setItem(AMBIGUOUS_KEY, JSON.stringify(allAmbiguous));
      } else {
        localStorage.removeItem(AMBIGUOUS_KEY);
      }
      setScanning(false);
      setScanPath(null);
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    });
  };

  const handleClearVerdicts = () => {
    if (rootDirs.length === 0) {
      setClearVerdictStatus("无媒体库目录");
      setTimeout(() => setClearVerdictStatus(null), 2000);
      return;
    }
    showConfirm("确定要清除所有裁决数据吗？这将删除所有 .mochi 文件并重置元数据匹配记录。", async () => {
      setClearVerdictStatus("清除中…");
      try {
        const msg = await invoke<string>("clear_all_verdicts", { rootPaths: rootDirs });
        setClearVerdictStatus(msg);
        localStorage.removeItem(AMBIGUOUS_KEY);
        window.dispatchEvent(new CustomEvent("mochi:data-changed"));
      } catch (err) {
        setClearVerdictStatus(`清除失败: ${err}`);
      }
      setTimeout(() => setClearVerdictStatus(null), 3000);
    });
  };

  return (
    <>
      <h2 style={sectionTitle}>媒体库</h2>

      {/* root dirs list */}
      {rootDirs.map((dir, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <span style={dirPath}>{dir}</span>
          <button
            style={deleteBtn}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#e81123")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
            onClick={() => removeDir(i)}
          >
            ✕
          </button>
        </div>
      ))}

      {adding && (
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <input
            ref={addInputRef}
            style={{ ...dirPath, outline: "none", border: "none" }}
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmAdd();
              if (e.key === "Escape") { setAdding(false); setAddValue(""); }
            }}
            onBlur={confirmAdd}
            placeholder="输入路径后按 Enter 确认"
          />
          <button
            style={deleteBtn}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#4caf50")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
            onClick={confirmAdd}
          >
            ✓
          </button>
        </div>
      )}

      <button style={textBtn} onClick={startAdd}>＋ 添加文件夹</button>

      {/* rescan */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
        <button style={{ ...actionBtn, opacity: scanning ? 0.5 : 1 }} disabled={scanning} onClick={handleRescan}>
          重新扫描
        </button>
        {scanning && (
          <>
            <BreathingDot size={16} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {scanPath ?? ""}
            </span>
            {scanCount > 0 && (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.15)" }}>
                {scanCount} 个系列
              </span>
            )}
          </>
        )}
      </div>

      {/* clear verdicts */}
      <div style={{ marginTop: 12 }}>
        <button style={textBtn} onClick={handleClearVerdicts}>清除所有裁决数据</button>
        {clearVerdictStatus && (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginLeft: 10 }}>
            {clearVerdictStatus}
          </span>
        )}
      </div>

      {/* ── Confirm Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div
            key="confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setConfirmModal(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.5)",
              backdropFilter: "blur(4px)",
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              transition={spring.gentle}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "rgba(14,14,14,0.96)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: "24px 28px",
                minWidth: 320,
                maxWidth: "85vw",
              }}
            >
              <p
                style={{
                  margin: "0 0 20px",
                  fontSize: 14,
                  color: "rgba(255,255,255,0.75)",
                  lineHeight: 1.6,
                }}
              >
                {confirmModal.title}
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                }}
              >
                <button
                  onClick={() => setConfirmModal(null)}
                  style={{
                    padding: "7px 20px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.45)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal(null);
                  }}
                  style={{
                    padding: "7px 20px",
                    borderRadius: 8,
                    border: "1px solid rgba(196,126,58,0.4)",
                    background: "rgba(196,126,58,0.12)",
                    color: "#c47e3a",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  确认
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
