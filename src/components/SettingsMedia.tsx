import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { motion, AnimatePresence } from "framer-motion";
import type { SeriesScan } from "../types";
import { spring } from "../animations/tokens";
import { BreathingDot } from "./BreathingDot";
import { sectionTitle, actionBtn, label } from "../styles/settings";

const ROOT_DIRS_KEY = "mochi_root_dirs";
const AMBIGUOUS_KEY = "mochi_ambiguous_series";

interface RootDirEntry {
  path: string;
  type: "auto" | "anime" | "tv" | "movie" | "variety";
}

const ROOT_TYPES = [
  { key: "auto", label: "自动" },
  { key: "anime", label: "动漫" },
  { key: "movie", label: "电影" },
  { key: "tv", label: "影视" },
  { key: "variety", label: "综艺" },
] as const;

const DEFAULT_DIRS: RootDirEntry[] = [];

const TMDB_KEY = "mochi_tmdb_key";

/** Load and migrate root dirs from localStorage. */
function loadRootDirs(): RootDirEntry[] {
  try {
    const raw = localStorage.getItem(ROOT_DIRS_KEY);
    if (!raw) return DEFAULT_DIRS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_DIRS;
    // Migrate old string[] format
    if (typeof parsed[0] === "string") {
      return (parsed as string[]).map((p) => ({ path: p, type: "auto" as const }));
    }
    return parsed as RootDirEntry[];
  } catch {
    return DEFAULT_DIRS;
  }
}


export default function SettingsMedia() {
  const [rootDirs, setRootDirs] = useState<RootDirEntry[]>(() =>
    loadRootDirs()
  );
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [addType, setAddType] = useState<RootDirEntry["type"]>("auto");
  const addInputRef = useRef<HTMLInputElement>(null);

  const [scanning, setScanning] = useState(false);
  const [scanPath, setScanPath] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);

  // ── Confirm modal state ──────────────────────────────────────────────────
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    onConfirm: () => void;
  } | null>(null);

  // ── Metadata state ───────────────────────────────────────────────────────
  const [tmdbKey, setTmdbKey] = useState(
    () => localStorage.getItem(TMDB_KEY) ?? ""
  );
  const [showKey, setShowKey] = useState(false);
  const [showTmdbHelp, setShowTmdbHelp] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);

  // ── Subscribe to batch fetch events from Rust backend ─────────────
  useEffect(() => {
    const unlistens: Array<() => void> = [];

    // On mount: check if a batch is already running
    invoke<[number, number] | null>("get_batch_status").then((status) => {
      if (status) {
        setBatchStatus(`正在拉取 (${status[0]}/${status[1]})…`);
      }
    }).catch(() => {});

    listen<number>("batch-fetch-start", () => {
      setBatchStatus("准备中…");
    }).then((fn) => unlistens.push(fn));

    listen<{ current: number; total: number; seriesName: string }>(
      "batch-fetch-progress",
      (event) => {
        setBatchStatus(`正在拉取 (${event.payload.current}/${event.payload.total})…`);
      }
    ).then((fn) => unlistens.push(fn));

    listen("batch-fetch-complete", () => {
      setBatchStatus("完成");
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
      setTimeout(() => setBatchStatus(null), 3000);
    }).then((fn) => unlistens.push(fn));

    listen("batch-fetch-cancelled", () => {
      setBatchStatus(null);
    }).then((fn) => unlistens.push(fn));

    return () => {
      unlistens.forEach((fn) => fn());
    };
  }, []);

  const saveTmdbKey = () => localStorage.setItem(TMDB_KEY, tmdbKey);

  const handleBatchFetch = async () => {
    if (batchStatus) return;
    setBatchStatus("准备中…");
    try {
      await invoke("batch_fetch_all_metadata", {
        tmdbApiKey: tmdbKey || undefined,
      });
    } catch (e) {
      setBatchStatus(`失败: ${e}`);
      setTimeout(() => setBatchStatus(null), 3000);
    }
  };

  const cancelBatchFetch = async () => {
    await invoke("cancel_batch_fetch");
    setBatchStatus(null);
  };

  const showConfirm = (title: string, onConfirm: () => void) => {
    setConfirmModal({ title, onConfirm });
  };

  useEffect(() => {
    localStorage.setItem(ROOT_DIRS_KEY, JSON.stringify(rootDirs));
  }, [rootDirs]);

  // Reload rootDirs when external changes happen (e.g. drag-and-drop)
  useEffect(() => {
    const handler = () => setRootDirs(loadRootDirs());
    window.addEventListener("mochi:data-changed", handler);
    return () => window.removeEventListener("mochi:data-changed", handler);
  }, []);

  const removeDir = async (i: number) => {
    const dir = rootDirs[i];
    try {
      await invoke("remove_root_dir", { rootPath: dir.path });
    } catch {
      // proceed even if DB cleanup fails
    }
    const updated = rootDirs.filter((_, idx) => idx !== i);
    localStorage.setItem(ROOT_DIRS_KEY, JSON.stringify(updated));
    setRootDirs(updated);
    window.dispatchEvent(new CustomEvent("mochi:data-changed"));
  };

  const changeDirType = (index: number) => {
    setRootDirs((prev) => {
      const next = [...prev];
      const types = ROOT_TYPES.map((t) => t.key);
      const currentIdx = types.indexOf(next[index].type);
      const nextIdx = (currentIdx + 1) % types.length;
      next[index] = { ...next[index], type: types[nextIdx] };
      return next;
    });
  };

  const startAdd = () => {
    setAdding(true);
    setAddValue("");
    setAddType("auto");
    setTimeout(() => addInputRef.current?.focus(), 0);
  };

  const handleBrowse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true });
      if (typeof selected === "string" && selected) {
        setAddValue(selected);
        setTimeout(() => addInputRef.current?.focus(), 0);
      }
    } catch {
      // dialog plugin unavailable
    }
  };

  const confirmAdd = async () => {
    const trimmed = addValue.trim();
    if (trimmed) {
      const entry: RootDirEntry = { path: trimmed, type: addType };
      setRootDirs((prev) => [...prev, entry]);
      // Auto-scan the newly added directory
      setScanning(true);
      setScanPath(trimmed);
      setScanCount(0);
      try {
        const result = await invoke<{ series: { folder_name: string }[]; ambiguous: SeriesScan[] }>("scan_library", {
          rootPath: trimmed,
          rootType: addType === "auto" ? null : addType,
        });
        setScanCount(result.series.length);
        if (result.ambiguous && result.ambiguous.length > 0) {
          const existingRaw = localStorage.getItem(AMBIGUOUS_KEY);
          const existing: SeriesScan[] = existingRaw ? JSON.parse(existingRaw) : [];
          const merged = [...existing];
          for (const amb of result.ambiguous) {
            if (!merged.some((a) => a.folder_name === amb.folder_name)) {
              merged.push(amb);
            }
          }
          localStorage.setItem(AMBIGUOUS_KEY, JSON.stringify(merged));
        }
        window.dispatchEvent(new CustomEvent("mochi:data-changed"));
      } catch {
        /* skip failed */
      }
      setScanning(false);
      setScanPath(null);
    }
    setAdding(false);
    setAddValue("");
    setAddType("auto");
  };

  const handleRescan = () => {
    showConfirm("重新扫描将覆盖现有扫描结果，确定继续吗？", async () => {
      setScanning(true);
      setScanCount(0);
      let totalCount = 0;
      let allAmbiguous: SeriesScan[] = [];
      for (const dir of rootDirs) {
        setScanPath(dir.path);
        try {
          const result = await invoke<{ series: { folder_name: string }[]; ambiguous: SeriesScan[] }>("scan_library", {
            rootPath: dir.path,
            rootType: dir.type === "auto" ? null : dir.type,
          });
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

  return (
    <>
      <h2 style={sectionTitle}>媒体库</h2>

      {/* ── 目录 ──────────────────────────────────────────── */}
      <label style={{ ...label, marginBottom: 10 }}>目录</label>

      {/* root dirs list */}
      {rootDirs.map((dir, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <span style={dirPath}>{dir.path}</span>
          <button
            onClick={() => changeDirType(i)}
            title="点击切换类型"
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              border: "none",
              background: "var(--color-surface-elevated)",
              color: dir.type === "auto" ? "var(--color-text-muted)" : "rgba(255,180,120,0.6)",
              whiteSpace: "nowrap",
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            {ROOT_TYPES.find(t => t.key === dir.type)?.label ?? dir.type}
          </button>
          <button
            style={deleteBtn}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-btn-close-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-muted)")}
            onClick={() => removeDir(i)}
          >
            ✕
          </button>
        </div>
      ))}

      {adding && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <input
              ref={addInputRef}
              style={{ ...dirPath, outline: "none", border: "none" }}
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmAdd();
                if (e.key === "Escape") { setAdding(false); setAddValue(""); setAddType("auto"); }
              }}
              placeholder="输入路径或点击浏览选择"
            />
            <button style={browseBtn} onClick={handleBrowse}>
              浏览
            </button>
            <button style={confirmBtn} onClick={confirmAdd}>
              添加
            </button>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {ROOT_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setAddType(t.key)}
                style={{
                  padding: "2px 10px",
                  borderRadius: 4,
                  border: "none",
                  fontSize: 11,
                  cursor: "pointer",
                  background: addType === t.key ? "var(--color-accent-dim)" : "var(--color-surface-elevated)",
                  color: addType === t.key ? "var(--color-accent)" : "var(--color-text-muted)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
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
            <span style={{ fontSize: 11, color: "var(--color-text-muted)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {scanPath ?? ""}
            </span>
            {scanCount > 0 && (
              <span style={{ fontSize: 11, color: "var(--color-surface-hover)" }}>
                {scanCount} 个系列
              </span>
            )}
          </>
        )}
      </div>


      {/* ── 元数据源 ───────────────────────────────────────── */}
      <div style={{ marginTop: 28, borderTop: "1px solid var(--color-surface-elevated)", paddingTop: 24 }}>
        <h2 style={{ ...sectionTitle, marginBottom: 10 }}>元数据源</h2>

        {/* TMDB Key */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <label style={{ ...label, marginBottom: 0, flex: 1 }}>影视元数据</label>
          <span
            onClick={() => setShowTmdbHelp(!showTmdbHelp)}
            style={{
              width: 18, height: 18,
              borderRadius: "50%",
              background: showTmdbHelp ? "var(--color-surface)" : "var(--color-surface-elevated)",
              color: "var(--color-text-muted)",
              fontSize: 11,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", userSelect: "none",
              flexShrink: 0,
            }}
            title="了解更多"
          >
            ?
          </span>
        </div>
        {/* TMDB help popover */}
        {showTmdbHelp && (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              lineHeight: 1.7,
              padding: "8px 12px",
              marginBottom: 8,
              borderRadius: 6,
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-surface-elevated)",
            }}
          >
            TMDB 是全球最大的影视数据库，Mochi 用它拉取海报、简介与演员表。
            注册免费，API Key 在账号设置页生成，仅存于你的电脑。
            <br />
            <span
              onClick={() => open("https://www.themoviedb.org/signup")}
              style={{
                color: "rgba(196,126,58,0.5)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-accent)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(196,126,58,0.5)")}
            >
              去注册 →
            </span>
          </div>
        )}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <input
            type={showKey ? "text" : "password"}
            style={inputStyle}
            value={tmdbKey}
            onChange={(e) => setTmdbKey(e.target.value)}
            onBlur={saveTmdbKey}
            placeholder="粘贴从 TMDB 获取的免费 API Key，仅存本地"
          />
          <button style={eyeBtn} onClick={() => setShowKey((v) => !v)} tabIndex={-1}>
            {showKey ? "隐藏" : "显示"}
          </button>
        </div>

        {/* batch fetch */}
        {batchStatus ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <BreathingDot size={24} />
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {batchStatus}
            </span>
            {batchStatus && batchStatus !== "完成" && !batchStatus.startsWith("失败") && (
              <button
                onClick={cancelBatchFetch}
                style={{
                  background: "var(--color-surface-elevated)",
                  border: "1px solid var(--color-surface)",
                  borderRadius: 6,
                  color: "var(--color-text-muted)",
                  fontSize: 11,
                  cursor: "pointer",
                  padding: "2px 10px",
                }}
              >
                取消
              </button>
            )}
          </div>
        ) : (
          <button style={actionBtn} onClick={handleBatchFetch}>
            批量拉取全部元数据
          </button>
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
              background: "var(--color-overlay)",
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
                background: "var(--color-modal-bg)",
                backdropFilter: "blur(12px)",
                border: "1px solid var(--color-surface)",
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
                  color: "var(--color-text-secondary)",
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
                    border: "1px solid var(--color-surface)",
                    background: "var(--color-surface-elevated)",
                    color: "var(--color-text-muted)",
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
                    border: "1px solid var(--color-accent-dim)",
                    background: "var(--color-accent-dim)",
                    color: "var(--color-accent)",
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

// ── local styles ────────────────────────────────────────────────────────────────

const dirPath: React.CSSProperties = {
  flex: 1,
  fontSize: 13,
  color: "var(--color-text-secondary)",
  background: "var(--color-surface-elevated)",
  borderRadius: 6,
  padding: "8px 14px",
};

const deleteBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--color-text-muted)",
  fontSize: 14,
  cursor: "pointer",
  padding: "0 4px",
};

const textBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--color-text-muted)",
  fontSize: 13,
  cursor: "pointer",
  padding: "4px 0",
};

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

const browseBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid var(--color-surface)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text-secondary)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const confirmBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid var(--color-accent-dim)",
  background: "var(--color-accent-dim)",
  color: "var(--color-accent)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
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
