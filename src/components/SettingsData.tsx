import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { spring } from "../animations/tokens";
import { sectionTitle } from "../styles/settings";
import { BreathingDot } from "./BreathingDot";
import type { Series } from "../types";

// ── Types ───────────────────────────────────────────────────────────────────

interface DataStats {
  series_total: number;
  series_with_metadata: number;
  episodes_with_progress: number;
  episodes_total: number;
}

type CardId = "cache" | "metadata" | "verdicts" | "progress" | "factory" | "nfo";

interface ConfirmState {
  cardId: CardId;
  title: string;
  onConfirm: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function SettingsData() {
  // ── State ────────────────────────────────────────────────────────────────
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [stats, setStats] = useState<DataStats | null>(null);
  const [status, setStatus] = useState<Record<CardId, string | null>>({
    cache: null,
    metadata: null,
    verdicts: null,
    progress: null,
    factory: null,
    nfo: null,
  });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ── NFO state ────────────────────────────────────────────────────────────
  const [nfoExporting, setNfoExporting] = useState(false);
  const [nfoExportProgress, setNfoExportProgress] = useState({ done: 0, total: 0, written: 0, skipped: 0, failed: 0 });
  const [nfoClearing, setNfoClearing] = useState(false);
  const [nfoClearProgress, setNfoClearProgress] = useState({ done: 0, total: 0, nfoDeleted: 0, sidecarsDeleted: 0 });
  const [nfoClearConfirmOpen, setNfoClearConfirmOpen] = useState(false);
  const [includeSidecars, setIncludeSidecars] = useState(false);

  // ── Load data ────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [size, s] = await Promise.all([
        invoke<number>("get_cache_size"),
        invoke<DataStats>("get_data_stats"),
      ]);
      setCacheSize(size);
      setStats(s);
    } catch {
      setCacheSize(null);
      setStats(null);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const clearImageCache = async () => {
    setStatus((p) => ({ ...p, cache: "清除中…" }));
    try {
      const freed = await invoke<number>("clear_cache");
      setStatus((p) => ({ ...p, cache: `已释放 ${formatBytes(freed)}` }));
      await loadAll();
      setTimeout(() => setStatus((p) => ({ ...p, cache: null })), 2000);
    } catch (e) {
      setStatus((p) => ({ ...p, cache: `失败: ${e}` }));
    }
  };

  const resetMetadata = async () => {
    setStatus((p) => ({ ...p, metadata: "重置中…" }));
    try {
      await invoke("reset_metadata");
      setStatus((p) => ({ ...p, metadata: "已重置" }));
      await loadAll();
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
      setTimeout(() => setStatus((p) => ({ ...p, metadata: null })), 2000);
    } catch (e) {
      setStatus((p) => ({ ...p, metadata: `失败: ${e}` }));
    }
  };

  const clearVerdicts = async () => {
    setStatus((p) => ({ ...p, verdicts: "清除中…" }));
    try {
      const rootDirs = JSON.parse(localStorage.getItem("mochi_root_dirs") ?? "[]") as { path: string }[];
      const rootPaths = rootDirs.map((d) => d.path);
      if (rootPaths.length === 0) {
        setStatus((p) => ({ ...p, verdicts: "无媒体库目录" }));
        setTimeout(() => setStatus((p) => ({ ...p, verdicts: null })), 2000);
        return;
      }
      const msg = await invoke<string>("clear_all_verdicts", { rootPaths });
      setStatus((p) => ({ ...p, verdicts: msg }));
      localStorage.removeItem("mochi_ambiguous_series");
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
      setTimeout(() => setStatus((p) => ({ ...p, verdicts: null })), 2000);
    } catch (e) {
      setStatus((p) => ({ ...p, verdicts: `失败: ${e}` }));
    }
  };

  const clearProgress = async () => {
    setStatus((p) => ({ ...p, progress: "清除中…" }));
    try {
      await invoke("clear_watch_progress");
      setStatus((p) => ({ ...p, progress: "已清除" }));
      await loadAll();
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
      setTimeout(() => setStatus((p) => ({ ...p, progress: null })), 2000);
    } catch (e) {
      setStatus((p) => ({ ...p, progress: `失败: ${e}` }));
    }
  };

  const factoryReset = async () => {
    setStatus((p) => ({ ...p, factory: "重置中…" }));
    try {
      await invoke("factory_reset");
      // Clear all mochi localStorage keys
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("mochi_")) {
          localStorage.removeItem(key);
        }
      }
      window.location.reload();
    } catch (e) {
      setStatus((p) => ({ ...p, factory: `失败: ${e}` }));
    }
  };

  // ── NFO actions ───────────────────────────────────────────────────────────

  const handleExportAllNfo = async () => {
    setNfoExporting(true);
    setNfoExportProgress({ done: 0, total: 0, written: 0, skipped: 0, failed: 0 });
    try {
      const rootDirs = JSON.parse(localStorage.getItem("mochi_root_dirs") ?? "[]") as { path: string }[];
      const rootPaths = rootDirs.map((d) => d.path);
      if (rootPaths.length === 0) {
        setStatus((p) => ({ ...p, nfo: "无媒体库目录" }));
        setNfoExporting(false);
        setTimeout(() => setStatus((p) => ({ ...p, nfo: null })), 2000);
        return;
      }
      const allSeries = await invoke<Series[]>("get_all_series");
      setNfoExportProgress((p) => ({ ...p, total: allSeries.length }));
      let written = 0;
      let skipped = 0;
      let failed = 0;
      for (const s of allSeries) {
        try {
          await invoke("export_nfo", {
            seriesId: s.id,
            rootPaths,
            overwrite: false,
          });
          written++;
        } catch (err) {
          const msg = String(err);
          // "NFO already exists" is the expected skip case; not a failure
          if (msg.includes("NFO already exists")) {
            skipped++;
          } else {
            failed++;
            console.warn(`NFO export failed for ${s.folder_name}:`, err);
          }
        }
        setNfoExportProgress((p) => ({ ...p, done: p.done + 1, written, skipped, failed }));
      }
      console.log(
        `NFO batch: ${written} written, ${skipped} skipped (already exist), ${failed} failed`
      );
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    } catch (err) {
      console.error("NFO batch export:", err);
    }
    setNfoExporting(false);
  };

  const handleClearAllNfo = async () => {
    setNfoClearing(true);
    setNfoClearProgress({ done: 0, total: 0, nfoDeleted: 0, sidecarsDeleted: 0 });
    try {
      const rootDirs = JSON.parse(localStorage.getItem("mochi_root_dirs") ?? "[]") as { path: string }[];
      const rootPaths = rootDirs.map((d) => d.path);
      if (rootPaths.length === 0) {
        setStatus((p) => ({ ...p, nfo: "无媒体库目录" }));
        setNfoClearing(false);
        setNfoClearConfirmOpen(false);
        setTimeout(() => setStatus((p) => ({ ...p, nfo: null })), 2000);
        return;
      }
      const allSeries = await invoke<Series[]>("get_all_series");
      setNfoClearProgress((p) => ({ ...p, total: allSeries.length }));
      let nfoDeleted = 0;
      let sidecarsDeleted = 0;
      for (const s of allSeries) {
        try {
          const result = await invoke<{ nfo_deleted: string | null; sidecars_deleted: string[] }>(
            "clear_nfo",
            { seriesId: s.id, rootPaths, includeSidecars }
          );
          if (result.nfo_deleted) nfoDeleted++;
          sidecarsDeleted += result.sidecars_deleted.length;
        } catch (err) {
          console.warn(`NFO clear failed for ${s.folder_name}:`, err);
        }
        setNfoClearProgress((p) => ({ ...p, done: p.done + 1, nfoDeleted, sidecarsDeleted }));
      }
      console.log(
        `NFO batch clear: ${nfoDeleted} NFO deleted, ${sidecarsDeleted} sidecars deleted`
      );
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    } catch (err) {
      console.error("NFO batch clear:", err);
    }
    setNfoClearing(false);
    setNfoClearConfirmOpen(false);
  };

  // ── Confirm helpers ──────────────────────────────────────────────────────

  const ask = (cardId: CardId, title: string, onConfirm: () => void) => {
    setConfirm({ cardId, title, onConfirm });
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <h2 style={sectionTitle}>数据</h2>

      {/* ── 图片缓存 ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={cardRow}>
          <div style={{ flex: 1 }}>
            <span style={cardTitle}>图片缓存</span>
            <p style={cardDesc}>
              从 TMDB 和 Bangumi 下载的海报与横幅
            </p>
            {cacheSize !== null && (
              <span style={cardMeta}>当前 {formatBytes(cacheSize)}</span>
            )}
          </div>
          <button
            style={btnStyle("default")}
            onClick={clearImageCache}
            disabled={status.cache !== null}
          >
            {status.cache ?? "清除"}
          </button>
        </div>
        <p style={cardNote}>清除后打开详情页会自动重新下载，不影响其他数据</p>
      </div>

      {/* ── 元数据 ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={cardRow}>
          <div style={{ flex: 1 }}>
            <span style={cardTitle}>元数据</span>
            <p style={cardDesc}>
              从 Bangumi 和 TMDB 获取的简介、年份、评分、演职员信息
            </p>
            {stats && stats.series_with_metadata > 0 && (
              <span style={cardMeta}>
                已为 {stats.series_with_metadata} 个系列拉取元数据
              </span>
            )}
          </div>
          <button
            style={btnStyle("default")}
            onClick={() =>
              ask(
                "metadata",
                "确定要重置所有元数据吗？扫描结果和观看记录不受影响。下次打开详情页可重新拉取。",
                resetMetadata
              )
            }
            disabled={status.metadata !== null}
          >
            {status.metadata ?? "重置"}
          </button>
        </div>
        <p style={cardNote}>不影响扫描结果和观看记录，可重新拉取</p>
      </div>

      {/* ── 裁决数据 ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={cardRow}>
          <div style={{ flex: 1 }}>
            <span style={cardTitle}>裁决数据</span>
            <p style={cardDesc}>
              手动指定的媒体类型和匹配结果，存储为媒体文件夹中的 .mochi 文件
            </p>
          </div>
          <button
            style={btnStyle("default")}
            onClick={() =>
              ask(
                "verdicts",
                "确定要清除所有裁决数据吗？这将删除所有 .mochi 文件并重置元数据匹配记录。",
                clearVerdicts
              )
            }
            disabled={status.verdicts !== null}
          >
            {status.verdicts ?? "清除"}
          </button>
        </div>
        <p style={cardNote}>不影响海报缓存和已拉取的元数据。重新扫描后会再次提示裁决</p>
      </div>

      {/* NFO 卡片 — 转移自 SettingsMedia */}
      <div style={cardStyle}>
        <div style={cardRow}>
          <div style={{ flex: 1 }}>
            <span style={cardTitle}>NFO 文件</span>
            <p style={cardDesc}>
              写入媒体文件夹的 tvshow.nfo / movie.nfo，可被 Plex / Jellyfin / Kodi 读取
            </p>
            {(nfoExporting || nfoClearing) && (
              <span style={cardMeta}>
                {nfoExporting && `导出中 ${nfoExportProgress.done} / ${nfoExportProgress.total}`}
                {nfoClearing && `清除中 ${nfoClearProgress.done} / ${nfoClearProgress.total}`}
              </span>
            )}
            {!nfoExporting && !nfoClearing && nfoExportProgress.total > 0 && (
              <span style={cardMeta}>
                上次导出 · {nfoExportProgress.written} 写入，{nfoExportProgress.skipped} 跳过，{nfoExportProgress.failed} 失败
              </span>
            )}
            {!nfoExporting && !nfoClearing && nfoClearProgress.total > 0 && (
              <span style={cardMeta}>
                上次清除 · {nfoClearProgress.nfoDeleted} NFO，{nfoClearProgress.sidecarsDeleted} 图片
              </span>
            )}
            {status.nfo && (
              <span style={{ ...cardMeta, color: "var(--color-accent)" }}>{status.nfo}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {(nfoExporting || nfoClearing) && <BreathingDot size={16} />}
            <button
              style={btnStyle("default")}
              onClick={handleExportAllNfo}
              disabled={nfoExporting || nfoClearing}
            >
              {nfoExporting ? "导出中…" : "批量导出"}
            </button>
            <button
              style={btnStyle("warn")}
              onClick={() => setNfoClearConfirmOpen(true)}
              disabled={nfoExporting || nfoClearing}
            >
              {nfoClearing ? "清除中…" : "清除所有"}
            </button>
          </div>
        </div>
        <p style={cardNote}>
          默认仅删除 mochi 写入的 NFO；可勾选“同时删除海报 / 背景图”一并清理 sidecar
        </p>
      </div>

      {/* ── 观看记录 ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={cardRow}>
          <div style={{ flex: 1 }}>
            <span style={cardTitle}>观看记录</span>
            <p style={cardDesc}>
              所有剧集的播放进度和完成状态
            </p>
            {stats && stats.episodes_with_progress > 0 && (
              <span style={cardMeta}>
                {stats.episodes_with_progress} / {stats.episodes_total} 集有播放记录
              </span>
            )}
          </div>
          <button
            style={btnStyle("warn")}
            onClick={() =>
              ask(
                "progress",
                "确定要清除所有观看记录吗？此操作不可撤销。",
                clearProgress
              )
            }
            disabled={status.progress !== null}
          >
            {status.progress ?? "清除"}
          </button>
        </div>
        <p style={cardNote}>此操作不可撤销。不影响扫描结果和元数据</p>
      </div>

      {/* ── Divider ──────────────────────────────────────────────── */}
      <div
        style={{
          borderTop: "1px solid var(--color-surface-elevated)",
          margin: "20px 0 24px",
        }}
      />

      {/* ── 恢复出厂设置 ──────────────────────────────────────── */}
      <div style={{ ...cardStyle, borderColor: "rgba(196,74,58,0.15)" }}>
        <div style={cardRow}>
          <div style={{ flex: 1 }}>
            <span style={{ ...cardTitle, color: "rgba(196,100,80,0.8)" }}>
              恢复出厂设置
            </span>
            <p style={cardDesc}>
              清除以上所有数据、媒体库配置、TMDB Key 和偏好设置
            </p>
          </div>
          <button
            style={btnStyle("danger")}
            onClick={() =>
              ask(
                "factory",
                "确定要恢复出厂设置吗？将清除所有本地数据：扫描结果、元数据、缓存、观看记录、媒体库配置和偏好设置。应用将恢复到首次启动状态。",
                factoryReset
              )
            }
            disabled={status.factory !== null}
          >
            {status.factory ?? "初始化"}
          </button>
        </div>
        <p style={cardNote}>
          应用将恢复到首次启动状态。媒体文件夹中的 .mochi 文件不受影响
        </p>
      </div>

      {/* ── Confirm modal ──────────────────────────────────────── */}
      <AnimatePresence>
        {confirm && (
          <motion.div
            key="confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setConfirm(null)}
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
                border:
                  confirm.cardId === "factory"
                    ? "1px solid rgba(196,74,58,0.3)"
                    : "1px solid var(--color-surface)",
                borderRadius: 12,
                padding: "24px 28px",
                minWidth: 340,
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
                {confirm.title}
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                }}
              >
                <button
                  onClick={() => setConfirm(null)}
                  style={modalBtn("cancel")}
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    confirm.onConfirm();
                    setConfirm(null);
                  }}
                  style={
                    confirm.cardId === "factory"
                      ? modalBtn("danger")
                      : modalBtn("confirm")
                  }
                >
                  确定
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clear NFO confirm modal — separate from the generic confirm because
          it needs a sidecar-deletion opt-in checkbox. */}
      <AnimatePresence>
        {nfoClearConfirmOpen && !nfoClearing && (
          <motion.div
            key="nfo-clear-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setNfoClearConfirmOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
            }}
          >
            <motion.div
              key="nfo-clear-card"
              initial={{ opacity: 0, scale: 0.94, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: -6 }}
              transition={spring.gentle}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--color-modal-bg)",
                borderRadius: 12,
                padding: 24,
                maxWidth: 400,
                border: "1px solid var(--color-surface)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-text)",
                  marginBottom: 10,
                }}
              >
                清除所有 NFO?
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  marginBottom: 16,
                  lineHeight: 1.6,
                }}
              >
                会删除所有已导出的 tvshow.nfo / movie.nfo 文件。
                <br />
                适用于：分享文件夹、迁移到其他工具、或重新生成元数据。
              </p>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  marginBottom: 20,
                  cursor: "pointer",
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: includeSidecars
                    ? "rgba(196, 126, 58, 0.08)"
                    : "var(--color-surface-elevated)",
                  border: includeSidecars
                    ? "1px solid var(--color-accent-dim)"
                    : "1px solid var(--color-surface)",
                }}
              >
                <input
                  type="checkbox"
                  checked={includeSidecars}
                  onChange={(e) => setIncludeSidecars(e.target.checked)}
                  style={{ marginTop: 2, cursor: "pointer" }}
                />
                <span style={{ lineHeight: 1.5 }}>
                  同时删除海报 / 背景图
                  <br />
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    注意：会一并删除 poster.jpg / fanart.jpg，
                    <strong>包括您手动放置的文件</strong>——mochi 无法区分来源
                  </span>
                </span>
              </label>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={() => setNfoClearConfirmOpen(false)}
                  style={{
                    padding: "8px 16px",
                    fontSize: 12,
                    color: "var(--color-text-secondary)",
                    background: "transparent",
                    border: "1px solid var(--color-surface)",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  onClick={handleClearAllNfo}
                  style={{
                    padding: "8px 16px",
                    fontSize: 12,
                    color: includeSidecars
                      ? "var(--color-modal-bg)"
                      : "var(--color-accent)",
                    background: includeSidecars
                      ? "var(--color-accent)"
                      : "var(--color-accent-dim)",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  清除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--color-surface-elevated)",
  borderRadius: 10,
  padding: "14px 18px",
  marginBottom: 10,
  background: "var(--color-surface-elevated)",
};

const cardRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 16,
};

const cardTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: "var(--color-text-secondary)",
};

const cardDesc: React.CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted)",
  margin: "4px 0 0",
  lineHeight: 1.5,
};

const cardMeta: React.CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-muted)",
  marginTop: 6,
  display: "inline-block",
};

const cardNote: React.CSSProperties = {
  fontSize: 11,
  color: "var(--color-surface-hover)",
  margin: "10px 0 0",
  lineHeight: 1.5,
};

function btnStyle(
  variant: "default" | "warn" | "danger"
): React.CSSProperties {
  const colors: Record<typeof variant, { border: string; bg: string; color: string }> = {
    default: {
      border: "1px solid var(--color-surface)",
      bg: "var(--color-surface-elevated)",
      color: "var(--color-text-muted)",
    },
    warn: {
      border: "1px solid rgba(196,140,58,0.3)",
      bg: "rgba(196,140,58,0.06)",
      color: "rgba(196,140,58,0.6)",
    },
    danger: {
      border: "1px solid rgba(196,74,58,0.3)",
      bg: "rgba(196,74,58,0.06)",
      color: "rgba(196,90,70,0.7)",
    },
  };
  const c = colors[variant];
  return {
    padding: "6px 18px",
    borderRadius: 8,
    border: c.border,
    background: c.bg,
    color: c.color,
    fontSize: 12,
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap" as const,
  };
}

function modalBtn(
  variant: "cancel" | "confirm" | "danger"
): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "7px 20px",
    borderRadius: 8,
    fontSize: 12,
    cursor: "pointer",
  };
  switch (variant) {
    case "cancel":
      return {
        ...base,
        border: "1px solid var(--color-surface)",
        background: "var(--color-surface-elevated)",
        color: "var(--color-text-muted)",
      };
    case "confirm":
      return {
        ...base,
        border: "1px solid var(--color-accent-dim)",
        background: "var(--color-accent-dim)",
        color: "var(--color-accent)",
      };
    case "danger":
      return {
        ...base,
        border: "1px solid rgba(196,74,58,0.4)",
        background: "rgba(196,74,58,0.12)",
        color: "rgba(196,80,60,0.9)",
      };
  }
}
