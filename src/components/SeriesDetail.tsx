import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type { Series, Episode } from "../types";
import { spring } from "../animations/tokens";
import { useImageSrc } from "../hooks/useImageSrc";
import { useBackground, GRADIENTS } from "../hooks/useBackground";
import { BreathingDot } from "./BreathingDot";

// ── Type dropdown options ──────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: "anime", label: "动漫" },
  { value: "tv", label: "影视" },
  { value: "movie", label: "电影" },
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

// ── SeriesDetail ───────────────────────────────────────────────────────

export default function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setBg } = useBackground();

  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [resumeEp, setResumeEp] = useState<Episode | null>(null);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const typeRef = useRef<HTMLDivElement>(null);
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const [editSearchTerm, setEditSearchTerm] = useState(false);
  const [searchTermInput, setSearchTermInput] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showKebabMenu, setShowKebabMenu] = useState(false);
  const kebabRef = useRef<HTMLDivElement>(null);

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
      const rootPaths: string[] = JSON.parse(localStorage.getItem("mochi_root_dirs") ?? "[]");
      const override = editSearchTerm && searchTermInput.trim()
        ? searchTermInput.trim()
        : null;
      await invoke("fetch_metadata", {
        seriesId,
        tmdbApiKey: tmdbKey || null,
        proxyUrl: proxyUrl || null,
        force: false,
        searchTermOverride: override,
        rootPaths: rootPaths.length > 0 ? rootPaths : null,
      });
      reload();
      setEditSearchTerm(false);
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    } catch (err) {
      console.error("Failed to refresh metadata:", err);
    }
    setRefreshingMeta(false);
  };

  const reload = useCallback(() => {
    if (seriesId == null) return;
    invoke<Series | null>("get_series_by_id", { id: seriesId }).then(setSeries);
    invoke<Episode[]>("get_episodes_by_series", { seriesId }).then(setEpisodes);
  }, [seriesId]);

  useEffect(() => { reload(); }, [reload]);

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

  const handleBack = useCallback(() => navigate("/"), [navigate]);

  const firstEp = episodes.find((e) => e.status === "ready");

  const handlePlay = () => {
    const ep = resumeEp ?? firstEp;
    if (ep) navigate(`/play/${ep.id}`);
  };

  const gradient = GRADIENTS[(series?.id ?? 0) % GRADIENTS.length];
  const posterSrc = useImageSrc(series?.poster_path ?? null);
  const initial = (series?.display_name ?? "?").charAt(0);
  const genres: string[] = series?.genres
    ? (() => {
        try {
          return JSON.parse(series.genres);
        } catch {
          return [];
        }
      })()
    : [];
  const synopsisLong = (series?.synopsis?.length ?? 0) > 80;

  if (!series) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ background: "#0e0e0e" }}
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
        className="flex items-center justify-center cursor-pointer bg-transparent border-none"
        whileHover={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        whileTap={{ scale: 0.92 }}
        style={{
          position: "fixed",
          top: 52,
          left: 16,
          zIndex: 60,
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.08)",
          fontSize: 16,
          color: "rgba(255,255,255,0.5)",
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
          maxWidth: 720,
          margin: "0 auto",
          padding: "80px 24px 60px",
        }}
      >
        {/* ── Top: poster + info ──────────────────────────────────── */}
        <div
          style={{ display: "flex", gap: 28, marginBottom: 32 }}
        >
          {/* Poster */}
          <motion.div
            layoutId={`poster-${series.id}`}
            variants={itemVariants}
            onClick={handlePlay}
            style={{
              width: 140,
              height: 210,
              borderRadius: 8,
              flexShrink: 0,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              backgroundImage: posterSrc ? `url(${posterSrc})` : gradient,
              backgroundSize: "cover",
              backgroundPosition: "center",
              cursor: episodes.some((e) => e.status === "ready")
                ? "pointer"
                : "default",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {!series.poster_path && (
              <span
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  fontSize: 42,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.12)",
                }}
              >
                {initial}
              </span>
            )}
            {/* Play overlay — framer-motion hover */}
            <motion.div
              whileHover={{ opacity: 1 }}
              whileTap={{ opacity: 1 }}
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.4)",
                opacity: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 36, color: "rgba(255,255,255,0.8)" }}>
                ▶
              </span>
            </motion.div>
          </motion.div>

          {/* Info column */}
          <motion.div
            variants={itemVariants}
            style={{ flex: 1, minWidth: 0, paddingTop: 4 }}
          >
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "rgba(255,255,255,0.9)",
                margin: "0 0 8px",
                letterSpacing: -0.5,
                lineHeight: 1.3,
              }}
            >
              {series.display_name}
            </h1>

            {/* Type dropdown + Kebab menu */}
            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>类型</span>
              <div ref={typeRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setTypeOpen(!typeOpen)}
                  className="border-none"
                  style={{
                    padding: "4px 26px 4px 10px",
                    borderRadius: 12,
                    background: typeOpen
                      ? "rgba(255,255,255,0.1)"
                      : "rgba(255,255,255,0.06)",
                    border: `1px solid ${typeOpen ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)"}`,
                    color: "rgba(255,255,255,0.5)",
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
                      right: 8,
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
                      background: "rgba(14,14,14,0.96)",
                      backdropFilter: "blur(14px)",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.08)",
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
                          onClick={() => {
                            handleTypeChange(opt.value);
                            setTypeOpen(false);
                          }}
                          className="border-none"
                          style={{
                            display: "block",
                            width: "100%",
                            padding: "8px 16px 8px 22px",
                            textAlign: "left",
                            background: isSelected
                              ? "rgba(255,255,255,0.06)"
                              : "transparent",
                            color: isSelected
                              ? "rgba(255,255,255,0.7)"
                              : "rgba(255,255,255,0.4)",
                            fontSize: 12,
                            cursor: "pointer",
                            outline: "none",
                            position: "relative",
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              (e.target as HTMLElement).style.background =
                                "rgba(255,255,255,0.05)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              (e.target as HTMLElement).style.background =
                                "transparent";
                            }
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
                                background: "#c47e3a",
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

              {/* Kebab menu */}
              <div ref={kebabRef} style={{ position: "relative" }}>
                {refreshingMeta ? (
                  <BreathingDot size={16} color="#c47e3a" style={{ cursor: "default" }} />
                ) : (
                  <button
                    onClick={() => setShowKebabMenu(!showKebabMenu)}
                    className="border-none"
                    style={{
                      width: 24,
                      height: 24,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 6,
                      background: showKebabMenu
                        ? "rgba(255,255,255,0.1)"
                        : "transparent",
                      color: "rgba(255,255,255,0.35)",
                      fontSize: 14,
                      cursor: "pointer",
                      outline: "none",
                      border: editSearchTerm
                        ? "1px solid rgba(196,126,58,0.5)"
                        : "1px solid transparent",
                    }}
                  >
                    ⋮
                  </button>
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
                        top: "calc(100% + 4px)",
                        right: 0,
                        background: "rgba(14,14,14,0.96)",
                        backdropFilter: "blur(14px)",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.08)",
                        overflow: "hidden",
                        zIndex: 50,
                        minWidth: 140,
                      }}
                    >
                      {[
                        {
                          label: "↻ 刷新元数据",
                          action: () => { handleRefreshMeta(); },
                          selected: false,
                          title: "仅补充缺失字段，已有数据不会被覆盖",
                        },
                        {
                          label: "✎ 编辑搜索词",
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
                          selected: editSearchTerm,
                        },
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={item.action}
                          title={"title" in item ? item.title : undefined}
                          className="border-none"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            width: "100%",
                            padding: "10px 16px",
                            textAlign: "left",
                            background: "transparent",
                            color: "rgba(255,255,255,0.5)",
                            fontSize: 12,
                            cursor: "pointer",
                            outline: "none",
                            gap: 8,
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background =
                              "rgba(255,255,255,0.06)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background =
                              "transparent";
                          }}
                        >
                          <span style={{ flex: 1 }}>{item.label}</span>
                          {item.selected && (
                            <span style={{ color: "#c47e3a", fontSize: 10 }}>•</span>
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Edit search term inline input */}
              {editSearchTerm && (
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
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
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.05)",
                      color: "rgba(255,255,255,0.5)",
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
                      background: "rgba(196,126,58,0.15)",
                      color: "rgba(196,126,58,0.8)",
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
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.35)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    取消
                  </button>
                </div>
              )}
            </div>

            {/* Metadata loading indicator */}
            <AnimatePresence>
              {refreshingMeta && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.25)",
                    marginBottom: 8,
                  }}
                >
                  正在拉取元数据…
                </motion.div>
              )}
            </AnimatePresence>

            {series.score != null && (
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 700,
                  color: "#c47e3a",
                  lineHeight: 1,
                  marginBottom: 8,
                }}
              >
                {(series.score / 10).toFixed(1)}
              </div>
            )}

            <div
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.35)",
                marginBottom: 8,
              }}
            >
              {[
                genres[0] ?? null,
                `${episodes.length} 集`,
                series.score ? `★${(series.score / 10).toFixed(1)}` : null,
                series.year?.toString(),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>

            {genres.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 12,
                }}
              >
                {genres.map((g) => (
                  <span
                    key={g}
                    style={{
                      fontSize: 11,
                      padding: "3px 10px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.08)",
                      color: "rgba(255,255,255,0.5)",
                    }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Action buttons */}
            {resumeEp ? (
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <motion.button
                  onClick={() => navigate(`/play/${resumeEp.id}`)}
                  className="cursor-pointer border-none"
                  whileHover={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                  whileTap={{ scale: 0.96 }}
                  style={{
                    padding: "10px 36px",
                    borderRadius: 22,
                    background: "rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.75)",
                    fontSize: 15,
                    fontWeight: 500,
                  }}
                >
                  继续 E{resumeEp.episode_number.toString().padStart(2, "0")}
                </motion.button>
                {resumeEp.id !== firstEp?.id && (
                  <motion.button
                    onClick={() => firstEp && navigate(`/play/${firstEp.id}`)}
                    className="cursor-pointer border-none"
                    whileHover={{ opacity: 0.8 }}
                    whileTap={{ scale: 0.96 }}
                    style={{
                      fontSize: 12,
                      opacity: 0.5,
                      color: "rgba(255,255,255,0.6)",
                      background: "transparent",
                      padding: "6px 12px",
                      borderRadius: 14,
                    }}
                  >
                    从头开始
                  </motion.button>
                )}
              </div>
            ) : firstEp ? (
              <motion.button
                onClick={handlePlay}
                className="cursor-pointer border-none"
                whileHover={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                whileTap={{ scale: 0.96 }}
                style={{
                  padding: "10px 36px",
                  borderRadius: 22,
                  background: "rgba(255,255,255,0.12)",
                  color: "rgba(255,255,255,0.75)",
                  fontSize: 15,
                  fontWeight: 500,
                }}
              >
                播放
              </motion.button>
            ) : (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
                无可用剧集
              </span>
            )}
          </motion.div>
        </div>

        {/* ── Synopsis (animated expand/collapse) ──────────────────── */}
        {series.synopsis && (
          <motion.div variants={itemVariants} style={{ marginBottom: 32 }}>
            <motion.div
              animate={{ maxHeight: synopsisExpanded ? 2000 : 80 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "rgba(255,255,255,0.3)",
                  lineHeight: 1.9,
                }}
              >
                {series.synopsis}
              </p>
            </motion.div>
            {synopsisLong && (
              <motion.button
                onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                className="border-none"
                whileHover={{ color: "rgba(255,255,255,0.45)" }}
                whileTap={{ scale: 0.96 }}
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.25)",
                  background: "none",
                  cursor: "pointer",
                  padding: "4px 0",
                  marginTop: 4,
                }}
              >
                {synopsisExpanded ? "收起 ▲" : "展开 ▼"}
              </motion.button>
            )}
          </motion.div>
        )}

        {/* ── Episode list ─────────────────────────────────────────── */}
        <motion.div variants={itemVariants}>
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.2)",
              textTransform: "uppercase",
              letterSpacing: 2,
              marginBottom: 14,
            }}
          >
            剧集
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {episodes.map((ep) => {
              const disabled =
                ep.status === "downloading" || ep.status === "missing";
              const isWatched = ep.watched_completed;
              const bg = isWatched
                ? "rgba(90,170,150,0.12)"
                : "rgba(255,255,255,0.05)";
              const border = isWatched
                ? "rgba(90,170,150,0.2)"
                : "rgba(255,255,255,0.08)";
              const color = isWatched
                ? "rgba(90,170,150,0.6)"
                : "rgba(255,255,255,0.45)";
              return (
                <motion.button
                  key={ep.id}
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) navigate(`/play/${ep.id}`);
                  }}
                  whileHover={
                    !disabled && !isWatched
                      ? {
                          scale: 1.05,
                          backgroundColor: "rgba(255,255,255,0.1)",
                        }
                      : {}
                  }
                  whileTap={!disabled ? { scale: 0.93 } : {}}
                  animate={{ opacity: disabled ? 0.25 : 1 }}
                  style={{
                    width: 56,
                    height: 38,
                    borderRadius: 8,
                    background: bg,
                    border: `1px solid ${border}`,
                    color,
                    fontSize: 13,
                    cursor: disabled ? "default" : "pointer",
                  }}
                >
                  {ep.episode_number.toString().padStart(2, "0")}
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
