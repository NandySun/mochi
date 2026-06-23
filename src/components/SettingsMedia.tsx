import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { motion, AnimatePresence } from "framer-motion";
import type { Series, SeriesScan } from "../types";
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

const DEFAULT_DIRS: RootDirEntry[] = [{ path: "D:\\Video", type: "auto" }];

const TMDB_KEY = "mochi_tmdb_key";
const PROXY_KEY = "mochi_proxy_url";
const DEFAULT_PROXY = "";

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
  const [clearVerdictStatus, setClearVerdictStatus] = useState<string | null>(null);

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
  const [proxyUrl, setProxyUrl] = useState(
    () => localStorage.getItem(PROXY_KEY) ?? DEFAULT_PROXY
  );
  const [batchStatus, setBatchStatus] = useState<string | null>(
    () => localStorage.getItem("mochi_batch_fetch_running") ? "后台拉取中…" : null
  );

  const saveTmdbKey = () => localStorage.setItem(TMDB_KEY, tmdbKey);
  const saveProxyUrl = () => localStorage.setItem(PROXY_KEY, proxyUrl);

  const handleBatchFetch = async () => {
    if (localStorage.getItem("mochi_batch_fetch_running")) return;
    localStorage.setItem("mochi_batch_fetch_running", "1");
    setBatchStatus("准备中…");
    window.dispatchEvent(new CustomEvent("mochi:batch-fetch-start"));
    try {
      const all: Series[] = await invoke("get_all_series");
      for (let i = 0; i < all.length; i++) {
        setBatchStatus(`正在拉取 (${i + 1}/${all.length})…`);
        window.dispatchEvent(new CustomEvent("mochi:batch-fetch-progress", {
          detail: { current: i + 1, total: all.length },
        }));
        try {
          await invoke("fetch_metadata", {
            seriesId: all[i].id,
            tmdbApiKey: tmdbKey,
            proxyUrl,
            force: true,
          });
          try { await invoke("fetch_cast", { seriesId: all[i].id, tmdbApiKey: tmdbKey }); } catch {}
          try { await invoke("fetch_episode_metadata", { seriesId: all[i].id, tmdbApiKey: tmdbKey }); } catch {}
        } catch { /* skip failed */ }
      }
      setBatchStatus("完成");
      window.dispatchEvent(new CustomEvent("mochi:batch-fetch-complete"));
    } catch {
      setBatchStatus("获取列表失败");
    }
    localStorage.removeItem("mochi_batch_fetch_running");
    window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    setTimeout(() => setBatchStatus(null), 3000);
  };

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
        setRootDirs((prev) => [...prev, { path: selected, type: "auto" }]);
        return;
      }
    } catch {
      // plugin not available, fall back to text input
    }
    setAdding(true);
    setAddValue("");
    setAddType("auto");
    setTimeout(() => addInputRef.current?.focus(), 0);
  };

  const confirmAdd = () => {
    const trimmed = addValue.trim();
    if (trimmed) {
      setRootDirs((prev) => [...prev, { path: trimmed, type: addType }]);
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

  const handleClearVerdicts = () => {
    if (rootDirs.length === 0) {
      setClearVerdictStatus("无媒体库目录");
      setTimeout(() => setClearVerdictStatus(null), 2000);
      return;
    }
    showConfirm("确定要清除所有裁决数据吗？这将删除所有 .mochi 文件并重置元数据匹配记录。", async () => {
      setClearVerdictStatus("清除中…");
      try {
        const msg = await invoke<string>("clear_all_verdicts", { rootPaths: rootDirs.map(d => d.path) });
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
          <span style={dirPath}>{dir.path}</span>
          <span style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 4,
            background: "rgba(255,255,255,0.06)",
            color: dir.type === "auto" ? "rgba(255,255,255,0.25)" : "rgba(255,180,120,0.6)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}>
            {ROOT_TYPES.find(t => t.key === dir.type)?.label ?? dir.type}
          </span>
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
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <input
              ref={addInputRef}
              style={{ ...dirPath, outline: "none", border: "none" }}
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmAdd();
                if (e.key === "Escape") { setAdding(false); setAddValue(""); setAddType("auto"); }
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
                  background: addType === t.key ? "rgba(196,126,58,0.2)" : "rgba(255,255,255,0.05)",
                  color: addType === t.key ? "#c47e3a" : "rgba(255,255,255,0.3)",
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

      {/* ── 元数据 ─────────────────────────────────────────── */}
      <div style={{ marginTop: 28 }}>
        <h2 style={sectionTitle}>元数据</h2>

        {/* TMDB Key */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <label style={{ ...label, marginBottom: 0, flex: 1 }}>影视元数据</label>
          <span
            onClick={() => setShowTmdbHelp(!showTmdbHelp)}
            style={{
              width: 18, height: 18,
              borderRadius: "50%",
              background: showTmdbHelp ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.3)",
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
              color: "rgba(255,255,255,0.3)",
              lineHeight: 1.7,
              padding: "8px 12px",
              marginBottom: 8,
              borderRadius: 6,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
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
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(196,126,58,0.8)")}
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

// ── local styles ────────────────────────────────────────────────────────────────

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
