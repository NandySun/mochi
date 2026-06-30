import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type { Series, Episode, CastMember } from "../types";
import { spring } from "../animations/tokens";
import { useImageSrc } from "../hooks/useImageSrc";
import { useBackground, GRADIENTS } from "../hooks/useBackground";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { BreathingDot } from "./BreathingDot";
import CastStrip from "./CastStrip";
import EpisodeModal from "./EpisodeModal";

// ── Type dropdown options ──────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: "anime", label: "动漫" },
  { value: "tv", label: "影视" },
  { value: "movie", label: "电影" },
  { value: "variety", label: "综艺" },
  { value: "unknown", label: "未知" },
] as const;

function typeLabel(value: string): string {
  return TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// ── Stagger animation variants ────────────────────────────────────────

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: spring.gentle,
  },
};

// ── Thumbnail gradient variants for episode strip ─────────────────────

const THUMB_GRADIENTS = [
  "linear-gradient(135deg, #1a1a2e 30%, #2a1a1a 100%)",
  "linear-gradient(135deg, #1a2a1e 30%, #1a1a2e 100%)",
  "linear-gradient(135deg, #2e1a1a 30%, #1a1a2e 100%)",
  "linear-gradient(135deg, #1a1a2e 30%, #1e1a2a 100%)",
  "linear-gradient(135deg, #1e2a1a 30%, #1a2a1e 100%)",
  "linear-gradient(135deg, #2a1e2a 30%, #1a1a2e 100%)",
  "linear-gradient(135deg, #1a2a2e 30%, #1a1e2a 100%)",
];

// ── Episode strip card (extracted for hook compliance) ────────────

function EpStripCard({
  episode,
  isResume,
  cardW,
  cardH,
  onPlay,
}: {
  episode: Episode;
  isResume: boolean;
  cardW: number;
  cardH: number;
  onPlay: (id: number) => void;
}) {
  const stillSrc = useImageSrc(episode.still_path ?? null);
  const thumbGrad = THUMB_GRADIENTS[(episode.episode_number - 1) % THUMB_GRADIENTS.length];
  const isWatched = !!episode.watched_completed;
  const disabled = episode.status === "downloading" || episode.status === "missing";

  return (
    <motion.div
      data-resume={isResume ? "true" : undefined}
      whileHover={{ scale: 1.035 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => { if (!disabled) onPlay(episode.id); }}
      style={{
        flexShrink: 0,
        width: cardW,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <div
        style={{
          width: cardW,
          height: cardH,
          borderRadius: 6,
          position: "relative",
          overflow: "hidden",
          backgroundImage: stillSrc ? `url(${stillSrc})` : thumbGrad,
          backgroundSize: "cover",
          backgroundPosition: "center",
          outline: isResume ? "2px solid var(--color-accent)" : undefined,
          outlineOffset: 2,
          marginBottom: 7,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 7,
            left: 8,
            background: "var(--color-overlay)",
            color: "var(--color-text)",
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 3,
            fontWeight: 600,
          }}
        >
          E{episode.episode_number.toString().padStart(2, "0")}
        </span>
        {isWatched && (
          <span
            style={{
              position: "absolute",
              bottom: 7,
              right: 8,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "var(--color-success)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "#fff",
            }}
          >
            ✓
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: "var(--color-text-secondary)",
          lineHeight: 1.35,
        }}
        title={episode.title ?? undefined}
      >
        {episode.title ?? `第 ${episode.episode_number} 集`}
      </div>
    </motion.div>
  );
}

// ── SeriesDetail ───────────────────────────────────────────────────────

export default function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setBg } = useBackground();

  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [resumeEp, setResumeEp] = useState<Episode | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const typeRef = useRef<HTMLDivElement>(null);
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [exportingNfo, setExportingNfo] = useState(false);
  const [overwritePromptOpen, setOverwritePromptOpen] = useState(false);
  const [rescanMsg, setRescanMsg] = useState<string | null>(null);
  const [editSearchTerm, setEditSearchTerm] = useState(false);
  const [searchTermInput, setSearchTermInput] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showKebabMenu, setShowKebabMenu] = useState(false);
  const kebabRef = useRef<HTMLDivElement>(null);

  // Popover / Modal state
  const [episodeModalOpen, setEpisodeModalOpen] = useState(false);

  // Cast
  const [castMembers, setCastMembers] = useState<CastMember[]>([]);

  // Episode strip scroll ref (for resume auto-scroll)
  const epStripRef = useRef<HTMLDivElement>(null);

  // Season switching for multi-season series
  const seasons = [...new Set(episodes.map((ep) => ep.season_number))].sort((a, b) => a - b);
  const [selectedSeason, setSelectedSeason] = useState<number>(seasons[0] ?? 1);

  // Keep selectedSeason valid when episodes change
  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(selectedSeason)) {
      setSelectedSeason(seasons[0]);
    } else if (seasons.length > 0 && selectedSeason === 0) {
      setSelectedSeason(seasons[0]);
    }
  }, [seasons, selectedSeason]);

  // Native wheel interception — React onWheel is sometimes bypassed by
  // the browser compositor. addEventListener with { passive: false }
  // guarantees we get first crack at the event.
  useEffect(() => {
    const el = epStripRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.scrollBy({ left: e.deltaY * 2.5, behavior: "auto" });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [episodes]);

  const seriesId = id ? Number(id) : null;

  // Close type dropdown on outside click
  useEffect(() => {
    if (!typeOpen) return;
    const handler = (e: MouseEvent) => {
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) {
        setTypeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [typeOpen]);

  // Close kebab menu on outside click
  useEffect(() => {
    if (!showKebabMenu) return;
    const handler = (e: MouseEvent) => {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setShowKebabMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showKebabMenu]);

  const handleTypeChange = async (newType: string) => {
    try {
      await invoke("update_series_type", { seriesId, newType });
      setSeries((prev) => prev ? { ...prev, type: newType as Series["type"] } : prev);
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    } catch (err) {
      console.error("Failed to update type:", err);
    }
  };

  const handleRefreshMeta = async () => {
    setShowKebabMenu(false);
    setRefreshingMeta(true);
    try {
      const tmdbKey = localStorage.getItem("mochi_tmdb_key") ?? "";
      const proxyUrl = localStorage.getItem("mochi_proxy_url") ?? "";
      const override = editSearchTerm && searchTermInput.trim()
        ? searchTermInput.trim()
        : null;
      await invoke("refresh_single_series", {
        seriesId,
        tmdbApiKey: tmdbKey || null,
        proxyUrl: proxyUrl || null,
        searchTermOverride: override || null,
      });
      reload();
      setEditSearchTerm(false);
      loadCast();
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    } catch (err) {
      console.error("Failed to refresh metadata:", err);
    }
    setRefreshingMeta(false);
  };

  const handleExportNfo = async (overwrite: boolean) => {
    setShowKebabMenu(false);
    setExportingNfo(true);
    try {
      // localStorage stores array of {path, type} objects; extract .path for the Rust side.
      const rootEntries: { path: string }[] = JSON.parse(
        localStorage.getItem("mochi_root_dirs") ?? "[]"
      );
      const rootPaths = rootEntries.map((d) => d.path);
      const result = await invoke<{ nfo_path: string; sidecar_written: string[] }>(
        "export_nfo",
        { seriesId, rootPaths, overwrite }
      );
      // Build a human-readable confirmation
      const sidecarNote =
        result.sidecar_written.length > 0
          ? `，并复制 ${result.sidecar_written.length} 张图片`
          : "";
      console.log(`NFO exported: ${result.nfo_path}${sidecarNote}`);
      // Re-fetch to update nfo_exported_at in the UI
      reload();
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    } catch (err) {
      // Surface the error to the user — silent failures are the worst UX.
      // The "NFO already exists" branch is a safety net; the normal re-export
      // path uses the confirm modal below, which sets overwrite=true and
      // bypasses this error.
      const msg = String(err);
      if (msg.includes("NFO already exists")) {
        alert(`NFO 已存在，未覆盖。\n如需覆盖，请再次点击「重新导出 NFO」并在弹窗中确认。`);
      } else {
        alert(`导出 NFO 失败：${msg}`);
      }
      console.warn("NFO export:", err);
    }
    setExportingNfo(false);
  };

  // Trigger from the ⋮ menu: skip the overwrite modal for the first export,
  // show a confirm modal when the NFO already exists. This is the UX that
  // makes the "重新导出" label meaningful — it asks before clobbering data.
  const handleExportNfoClick = () => {
    if (exportingNfo || !series) return;
    if (series.nfo_exported_at) {
      setShowKebabMenu(false);
      setOverwritePromptOpen(true);
    } else {
      handleExportNfo(false);
    }
  };

  const handleOverwriteConfirm = () => {
    setOverwritePromptOpen(false);
    handleExportNfo(true);
  };

  const handleRescan = async () => {
    setShowKebabMenu(false);
    setRescanning(true);
    try {
      const rootDirs = JSON.parse(localStorage.getItem("mochi_root_dirs") ?? "[]");
      const rootPaths: string[] = Array.isArray(rootDirs) && rootDirs.length > 0
        ? (typeof rootDirs[0] === "string" ? rootDirs : rootDirs.map((d: { path: string }) => d.path))
        : [];
      const result = await invoke<{ episodes_found: number; episodes_new: number; episodes_deleted: number }>(
        "rescan_series_folder",
        { seriesId, rootPaths }
      );
      reload();
      const parts: string[] = [`找到 ${result.episodes_found} 集`];
      if (result.episodes_new > 0) parts.push(`新增 ${result.episodes_new}`);
      if (result.episodes_deleted > 0) parts.push(`移除 ${result.episodes_deleted}`);
      setRescanMsg(parts.join("，"));
      setTimeout(() => setRescanMsg(null), 5000);
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    } catch (err) {
      console.error("Failed to rescan:", err);
      setRescanMsg(`扫描失败: ${String(err)}`);
      setTimeout(() => setRescanMsg(null), 5000);
    }
    setRescanning(false);
  };

  const loadCast = useCallback(() => {
    if (seriesId == null) return;
    invoke<CastMember[]>("get_series_cast", { seriesId })
      .then(setCastMembers)
      .catch(() => setCastMembers([]));
  }, [seriesId]);

  const reload = useCallback(() => {
    if (seriesId == null) return;
    invoke<Series | null>("get_series_by_id", { id: seriesId }).then(setSeries);
    invoke<Episode[]>("get_episodes_by_series", { seriesId }).then(setEpisodes);
  }, [seriesId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { loadCast(); }, [loadCast]);

  useEffect(() => {
    if (seriesId == null) return;
    invoke<Episode | null>("get_series_resume_episode", { seriesId })
      .then(setResumeEp)
      .catch(() => setResumeEp(null));
  }, [seriesId]);

  useEffect(() => {
    if (!series) return;
    const g = GRADIENTS[(series.id ?? 0) % GRADIENTS.length];
    setBg((prev) => ({
      ...prev,
      gradient: g,
      fanartPath: series.fanart_path,
      maskGradient:
        "linear-gradient(to top, rgba(14,14,14,0.92) 0%, rgba(14,14,14,0.6) 40%, rgba(14,14,14,0.25) 100%)",
    }));
  }, [series, setBg]);

  // Auto-scroll episode strip to resume position
  useEffect(() => {
    if (!resumeEp || !epStripRef.current) return;
    const timer = setTimeout(() => {
      const strip = epStripRef.current;
      if (!strip) return;
      const resumeCard = strip.querySelector('[data-resume="true"]');
      if (resumeCard) {
        const stripRect = strip.getBoundingClientRect();
        const cardRect = resumeCard.getBoundingClientRect();
        const offset = cardRect.left - stripRect.left - stripRect.width / 3;
        strip.scrollBy({ left: offset, behavior: "smooth" });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [resumeEp]);

  const handleBack = useCallback(() => navigate("/"), [navigate]);

  const firstEp = episodes.find((e) => e.status === "ready");

  const gradient = GRADIENTS[(series?.id ?? 0) % GRADIENTS.length];
  const posterSrc = useImageSrc(series?.poster_path ?? null);
  const initial = (series?.title ?? "?").charAt(0);
  const genres: string[] = series?.genres
    ? (() => {
        try {
          return JSON.parse(series.genres);
        } catch {
          return [];
        }
      })()
    : [];

  // ── Responsive breakpoints ──────────────────────────────────────
  const winW = useWindowWidth();
  const bp: "XL" | "L" | "M" | "S" = winW >= 1400 ? "XL" : winW >= 1100 ? "L" : winW >= 900 ? "M" : "S";
  const r = {
    posterW: bp === "XL" ? 240 : bp === "L" ? 200 : bp === "M" ? 160 : 130,
    posterH: bp === "XL" ? 360 : bp === "L" ? 300 : bp === "M" ? 240 : 195,
    heroGap: bp === "XL" ? 40 : bp === "L" ? 32 : bp === "M" ? 24 : 20,
    titleSize: bp === "XL" ? 32 : bp === "L" ? 28 : bp === "M" ? 24 : 20,
    infoSize: bp === "XL" ? 15 : bp === "L" ? 14 : 13,
    avatarSize: bp === "XL" ? 52 : bp === "L" ? 48 : bp === "M" ? 40 : 36,
    cardW: bp === "XL" ? 220 : bp === "L" ? 180 : bp === "M" ? 150 : 130,
    cardH: bp === "XL" ? 124 : bp === "L" ? 101 : bp === "M" ? 84 : 73,
    hideSubName: bp === "S",
    maxWidth: bp === "XL" ? 1200 : bp === "L" ? 960 : 720,
  };

  if (!series) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ background: "var(--color-bg)" }}
      >
        <BreathingDot size={24} />
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        scrollbarWidth: "none",
      }}
    >
      <style>{`div::-webkit-scrollbar { display: none; }`}</style>

      {/* ── Return button ──────────────────────────────────────────── */}
      <motion.button
        onClick={handleBack}
        whileHover={{ backgroundColor: "var(--color-surface-hover)" }}
        whileTap={{ scale: 0.92 }}
        style={{
          position: "fixed",
          top: 52,
          left: 16,
          zIndex: 60,
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "var(--color-surface)",
          border: "none",
          fontSize: 16,
          color: "var(--color-text-secondary)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ←
      </motion.button>

      {/* ── Content (staggered entrance) ────────────────────────────── */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{
          maxWidth: r.maxWidth,
          margin: "0 auto",
          padding: "80px 32px 60px",
        }}
      >
        {/* ── Hero: poster + right dual-zone ───────────────────────── */}
        <div style={{ display: "flex", gap: r.heroGap, marginBottom: 32 }}>
          {/* Poster */}
          <motion.div
            layoutId={`poster-${series.id}`}
            variants={itemVariants}
            style={{
              width: r.posterW,
              height: r.posterH,
              borderRadius: 8,
              flexShrink: 0,
              boxShadow: "0 8px 32px var(--color-overlay)",
              backgroundImage: posterSrc ? `url(${posterSrc})` : gradient,
              backgroundSize: "cover",
              backgroundPosition: "center",
              cursor: episodes.some((e) => e.status === "ready") ? "pointer" : "default",
              position: "relative",
              overflow: "hidden",
            }}
            onClick={() => {
              const ep = resumeEp ?? firstEp;
              if (ep) navigate(`/play/${ep.id}`);
            }}
          >
            {!series.poster_path && (
              <span
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  fontSize: 52,
                  fontWeight: 700,
                  color: "var(--color-surface)",
                }}
              >
                {initial}
              </span>
            )}
            <motion.div
              whileHover={{ opacity: 1 }}
              style={{
                position: "absolute",
                inset: 0,
                background: "var(--color-overlay)",
                opacity: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 36, color: "var(--color-text)" }}>▶</span>
            </motion.div>
          </motion.div>

          {/* Hero right: info flow */}
          <motion.div
            variants={itemVariants}
            style={{ flex: 1, minWidth: 0, paddingTop: 2 }}
          >
            {/* Title */}
            <h1
              style={{
                fontSize: r.titleSize,
                fontWeight: 700,
                color: "var(--color-text)",
                margin: "0 0 6px",
                letterSpacing: 0.3,
                lineHeight: 1.2,
              }}
            >
              {series.title}
            </h1>

            {/* Info row: score · year · episode count · type */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: r.infoSize,
                color: "var(--color-text-muted)",
                marginBottom: 14,
              }}
            >
              {series.score != null && (
                <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>
                  {series.score.toFixed(1)}
                </span>
              )}
              <span style={{ opacity: 0.3 }}>·</span>
              <span>{series.year ?? "—"}</span>
              <span style={{ opacity: 0.3 }}>·</span>
              <span>{episodes.length} 集</span>
            </div>

            {/* Type dropdown */}
            <div style={{ marginBottom: 16 }}>
              <div ref={typeRef} style={{ position: "relative", display: "inline-block" }}>
                  <button
                    onClick={() => setTypeOpen(!typeOpen)}
                    style={{
                      padding: "3px 24px 3px 10px",
                      borderRadius: 4,
                      background: typeOpen ? "var(--color-surface)" : "var(--color-surface-elevated)",
                      border: `1px solid ${typeOpen ? "var(--color-surface-hover)" : "var(--color-surface)"}`,
                      color: "var(--color-text-secondary)",
                      fontSize: 12,
                      cursor: "pointer",
                      outline: "none",
                      position: "relative",
                    }}
                  >
                    {typeLabel(series.type)}
                    <span
                      style={{
                        position: "absolute",
                        right: 7,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: 8,
                        opacity: 0.35,
                      }}
                    >
                      ▾
                    </span>
                  </button>
                  {typeOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        left: 0,
                        background: "var(--color-modal-bg)",
                        backdropFilter: "blur(14px)",
                        borderRadius: 8,
                        border: "1px solid var(--color-surface)",
                        overflow: "hidden",
                        zIndex: 50,
                        minWidth: 100,
                      }}
                    >
                      {TYPE_OPTIONS.map((opt) => {
                        const isSelected = opt.value === series.type;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => { handleTypeChange(opt.value); setTypeOpen(false); }}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "8px 16px 8px 22px",
                              textAlign: "left",
                              background: isSelected ? "var(--color-surface-elevated)" : "transparent",
                              color: isSelected ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                              fontSize: 12,
                              cursor: "pointer",
                              border: "none",
                              outline: "none",
                              position: "relative",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) (e.target as HTMLElement).style.background = "var(--color-surface-elevated)";
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) (e.target as HTMLElement).style.background = "transparent";
                            }}
                          >
                            {isSelected && (
                              <span
                                style={{
                                  position: "absolute",
                                  left: 8,
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  width: 4,
                                  height: 4,
                                  borderRadius: "50%",
                                  background: "var(--color-accent)",
                                }}
                              />
                            )}
                            {opt.label}
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Edit search term inline */}
              {editSearchTerm && (
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchTermInput}
                    onChange={(e) => setSearchTermInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRefreshMeta();
                      if (e.key === "Escape") setEditSearchTerm(false);
                    }}
                    placeholder="输入搜索词"
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--color-surface)",
                      background: "var(--color-surface-elevated)",
                      color: "var(--color-text-secondary)",
                      outline: "none",
                      width: 120,
                    }}
                  />
                  <button
                    onClick={handleRefreshMeta}
                    style={{
                      fontSize: 10,
                      padding: "3px 10px",
                      borderRadius: 6,
                      border: "none",
                      background: "var(--color-accent-dim)",
                      color: "var(--color-accent)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    确认
                  </button>
                  <button
                    onClick={() => setEditSearchTerm(false)}
                    style={{
                      fontSize: 10,
                      padding: "3px 10px",
                      borderRadius: 6,
                      border: "none",
                      background: "var(--color-surface-elevated)",
                      color: "var(--color-text-muted)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    取消
                  </button>
                </div>
              )}

              {/* Refreshing indicator */}
              <AnimatePresence>
                {refreshingMeta && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}
                  >
                    正在拉取元数据…
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Action buttons */}
              {resumeEp ? (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <motion.button
                    onClick={() => navigate(`/play/${resumeEp.id}`)}
                    whileHover={{ filter: "brightness(1.1)" }}
                    whileTap={{ scale: 0.96 }}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 8,
                      background: "var(--color-accent)",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: "none",
                      fontFamily: "inherit",
                    }}
                  >
                    ▶ 继续 E{resumeEp.episode_number.toString().padStart(2, "0")}
                  </motion.button>
                  {resumeEp.id !== firstEp?.id && (
                    <motion.button
                      onClick={() => firstEp && navigate(`/play/${firstEp.id}`)}
                      whileHover={{ background: "var(--color-surface)" }}
                      whileTap={{ scale: 0.96 }}
                      style={{
                        padding: "8px 18px",
                        borderRadius: 8,
                        background: "var(--color-surface-elevated)",
                        border: "1px solid var(--color-surface-elevated)",
                        color: "var(--color-text-secondary)",
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      从头开始
                    </motion.button>
                  )}
                </div>
              ) : firstEp ? (
                <motion.button
                  onClick={() => navigate(`/play/${firstEp.id}`)}
                  whileHover={{ background: "var(--color-text-muted)" }}
                  whileTap={{ scale: 0.96 }}
                  style={{
                    padding: "8px 18px",
                    borderRadius: 8,
                    background: "var(--color-accent)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: "none",
                    fontFamily: "inherit",
                  }}
                >
                  ▶ 播放
                </motion.button>
              ) : (
                <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>无可用剧集</span>
              )}

              {/* Genres */}
              {genres.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
                  {genres.map((g) => (
                    <span
                      key={g}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        borderRadius: 10,
                        background: "var(--color-surface)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {/* Synopsis — scrollable capped area */}
              {series.synopsis && (
                <>
                  <style>{`.synopsis-scroll::-webkit-scrollbar { width: 4px; } .synopsis-scroll::-webkit-scrollbar-track { background: transparent; } .synopsis-scroll::-webkit-scrollbar-thumb { background: var(--color-surface); border-radius: 2px; } .synopsis-scroll::-webkit-scrollbar-thumb:hover { background: var(--color-surface-hover); }`}</style>
                  <div
                    className="synopsis-scroll"
                    style={{
                      margin: "20px 0 0",
                      maxWidth: 720,
                      maxHeight: 120,
                      overflowY: "auto",
                      scrollbarWidth: "thin" as const,
                      scrollbarColor: "var(--color-surface) transparent",
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13.5,
                        lineHeight: 1.85,
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {series.synopsis}
                    </p>
                  </div>
                </>
              )}
          </motion.div>
        </div>

        {/* ── Cast section (below hero, left-aligned) ──────────────── */}
        {castMembers.length > 0 && (
          <motion.div variants={itemVariants} style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: 1.5,
                marginBottom: 8,
              }}
            >
              演员
            </div>
            <CastStrip castMembers={castMembers} avatarSize={r.avatarSize} hideSubName={r.hideSubName} />
          </motion.div>
        )}

        {/* ── Episode strip ────────────────────────────────────────── */}
        {episodes.length > 0 && (
          <motion.div variants={itemVariants} style={{ marginTop: 32 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                  }}
                >
                  剧集
                </span>
                {seasons.length > 1 && (
                  <div style={{ display: "flex", gap: 4 }}>
                    {seasons.map((s) => {
                      const isActive = s === selectedSeason;
                      return (
                        <button
                          key={s}
                          onClick={() => setSelectedSeason(s)}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: 4,
                            border: "none",
                            cursor: "pointer",
                            background: isActive ? "var(--color-accent)" : "var(--color-surface-elevated)",
                            color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                            transition: "all 0.2s",
                            fontFamily: "inherit",
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) {
                              (e.target as HTMLElement).style.background = "var(--color-surface)";
                              (e.target as HTMLElement).style.color = "var(--color-text-secondary)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) {
                              (e.target as HTMLElement).style.background = "var(--color-surface-elevated)";
                              (e.target as HTMLElement).style.color = "var(--color-text-muted)";
                            }
                          }}
                        >
                          S{s}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <span
                onClick={() => setEpisodeModalOpen(true)}
                style={{
                  fontSize: 14,
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  userSelect: "none",
                  padding: "2px 6px",
                  borderRadius: 4,
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.color = "var(--color-text-secondary)";
                  (e.target as HTMLElement).style.background = "var(--color-surface-elevated)";
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.color = "var(--color-text-muted)";
                  (e.target as HTMLElement).style.background = "transparent";
                }}
                title="查看全部剧集"
              >
                ▤
              </span>
            </div>

            <div style={{ position: "relative" }}>
              <div
                ref={epStripRef}
                style={{
                  display: "flex",
                  gap: 14,
                  overflowX: "auto",
                  padding: "4px 2px 8px",
                  scrollbarWidth: "none",
                  scrollBehavior: "smooth",
                }}
              >
                <style>{`.ep-strip::-webkit-scrollbar { display: none; }`}</style>
                {episodes
                  .filter((ep) => ep.season_number === selectedSeason)
                  .map((ep) => (
                    <EpStripCard
                      key={ep.id}
                      episode={ep}
                      isResume={ep.id === resumeEp?.id}
                      cardW={r.cardW}
                      cardH={r.cardH}
                      onPlay={(epId) => navigate(`/play/${epId}`)}
                    />
                  ))}
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* ── Wrench FAB (bottom-right) ──────────────────────────────── */}
      <div ref={kebabRef} style={{ position: "fixed", bottom: 24, right: 24, zIndex: 60 }}>
        {(refreshingMeta || rescanning) ? (
          <BreathingDot size={20} color="var(--color-accent)" style={{ cursor: "default" }} />
        ) : (
          <motion.button
            onClick={() => setShowKebabMenu(!showKebabMenu)}
            whileHover={{ backgroundColor: "var(--color-surface-hover)" }}
            whileTap={{ scale: 0.92 }}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: showKebabMenu ? "var(--color-surface)" : "var(--color-surface-elevated)",
              border: "1px solid var(--color-surface)",
              color: "var(--color-text-muted)",
              fontSize: 16,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              outline: "none",
            }}
          >
            🔧
          </motion.button>
        )}
        <AnimatePresence>
          {showKebabMenu && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={spring.gentle}
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                right: 0,
                background: "var(--color-modal-bg)",
                backdropFilter: "blur(14px)",
                borderRadius: 8,
                border: "1px solid var(--color-surface)",
                overflow: "hidden",
                zIndex: 50,
                minWidth: 150,
              }}
            >
              {[
                {
                  label: "↻ 刷新元数据",
                  action: () => { handleRefreshMeta(); },
                },
                {
                  label: rescanning ? "⟳ 扫描中…" : "↺ 扫描新剧集",
                  action: () => { if (!rescanning) handleRescan(); },
                },
                {
                  label: editSearchTerm ? "✓ 编辑搜索词" : "✎ 编辑搜索词",
                  action: () => {
                    setShowKebabMenu(false);
                    if (!editSearchTerm) {
                      setSearchTermInput(series.search_term);
                      setEditSearchTerm(true);
                      setTimeout(() => searchInputRef.current?.focus(), 0);
                    } else {
                      setEditSearchTerm(false);
                    }
                  },
                },
                {
                  label: exportingNfo
                    ? "⟳ 导出 NFO…"
                    : series.nfo_exported_at
                    ? "↓ 重新导出 NFO"
                    : "↓ 导出 NFO",
                  action: handleExportNfoClick,
                },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={item.action}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: "10px 16px",
                    textAlign: "left",
                    background: "transparent",
                    color: "var(--color-text-secondary)",
                    fontSize: 12,
                    cursor: "pointer",
                    border: "none",
                    outline: "none",
                    gap: 8,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--color-surface-elevated)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  {item.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Rescan result toast ──────────────────────────────────── */}
      {rescanMsg && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            right: 24,
            zIndex: 65,
            padding: "6px 14px",
            borderRadius: 6,
            background: "var(--color-accent-dim)",
            border: "1px solid var(--color-accent-dim)",
            color: "var(--color-text)",
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          {rescanMsg}
        </div>
      )}

      {/* ── EpisodeModal ───────────────────────────────────────────── */}
      <EpisodeModal
        episodes={episodes}
        resumeEpId={resumeEp?.id ?? null}
        isOpen={episodeModalOpen}
        onClose={() => setEpisodeModalOpen(false)}
        onPlay={(epId) => navigate(`/play/${epId}`)}
      />

      {/* ── Overwrite NFO confirm modal ──────────────────────────────
          Triggered when the user clicks "重新导出 NFO" (i.e. a previous
          export exists). Confirms before clobbering the existing file.
          Sidecar images (poster.jpg / fanart.jpg) are never re-copied;
          only the NFO itself is rewritten. */}
      <AnimatePresence>
        {overwritePromptOpen && (
          <motion.div
            key="overwrite-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring.gentle}
            onClick={() => setOverwritePromptOpen(false)}
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
              key="overwrite-card"
              initial={{ opacity: 0, scale: 0.94, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: -6 }}
              transition={spring.gentle}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--color-modal-bg)",
                borderRadius: 12,
                padding: 24,
                maxWidth: 360,
                border: "1px solid var(--color-surface)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-text)",
                  marginBottom: 8,
                }}
              >
                覆盖 NFO?
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  marginBottom: 20,
                  lineHeight: 1.6,
                }}
              >
                该系列已有 NFO 文件。覆盖会替换现有内容。
                <br />
                海报 / 背景图（poster.jpg / fanart.jpg）不会被重新复制。
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={() => setOverwritePromptOpen(false)}
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
                  onClick={handleOverwriteConfirm}
                  style={{
                    padding: "8px 16px",
                    fontSize: 12,
                    color: "var(--color-modal-bg)",
                    background: "var(--color-accent)",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  覆盖导出
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
