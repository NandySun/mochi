import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useMotionValue, useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type { Series, SeriesScan } from "../types";
import { spring } from "../animations/tokens";
import { useImageSrc } from "../hooks/useImageSrc";
import { useBackground, GRADIENTS } from "../hooks/useBackground";
import { BreathingDot } from "./BreathingDot";
import MetadataVerdict from "./MetadataVerdict";
import SearchOverlay from "./SearchOverlay";

const FILTERS = [
  { key: "resume", label: "继续" },
  { key: "all", label: "全部" },
  { key: "anime", label: "动漫" },
  { key: "tv", label: "影视" },
  { key: "movie", label: "电影" },
  { key: "variety", label: "综艺" },
] as const;

// ── PosterCard ─────────────────────────────────────────────────────────────
// Phase 3: framer-motion replaces CSS transitions + imperative hover handlers.

function PosterCard({
  s,
  isActive,
  onClick,
}: {
  s: Series;
  isActive: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const posterSrc = useImageSrc(s.poster_path);
  const gradient = GRADIENTS[s.id % GRADIENTS.length];
  const initial = s.title.charAt(0);

  return (
    <motion.button
      data-series-id={s.id}
      layoutId={`poster-${s.id}`}
      onClick={onClick}
      className="cursor-pointer border-none"
      layout
      animate={{
        scale: isActive ? 1.12 : 1,
        opacity: isActive ? 1 : 0.5,
        boxShadow: isActive
          ? "0 0 24px var(--color-accent-dim), 0 8px 32px var(--color-overlay)"
          : "0 0 0px rgba(196,126,58,0)",
      }}
      transition={spring.poster}
      whileHover={{ opacity: isActive ? 1 : 0.75 }}
      whileTap={{ scale: 0.97 }}
      style={{
        width: "clamp(110px, 15vw, 220px)",
        height: "clamp(165px, 22.5vw, 330px)",
        borderRadius: 6,
        overflow: "visible",
        flexShrink: 0,
        position: "relative",
        backgroundImage: posterSrc ? `url(${posterSrc})` : gradient,
        backgroundSize: "cover",
        backgroundPosition: "center",
        border: "none",
      }}
    >
      {!posterSrc && (
        <span
          className="absolute font-bold select-none pointer-events-none"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: "clamp(36px, 5.3vw, 72px)",
            color: "var(--color-surface)",
            letterSpacing: 2,
          }}
        >
          {initial}
        </span>
      )}
    </motion.button>
  );
}

// ── PosterWall ─────────────────────────────────────────────────────────────

export default function PosterWall({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [series, setSeries] = useState<Series[]>([]);
  const [filter, setFilter] = useState<"resume" | "all" | "anime" | "tv" | "movie" | "variety">("all");
  const [resumeEp, setResumeEp] = useState<{ id: number; series_id: number; episode_number: number } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [ambiguousSeries, setAmbiguousSeries] = useState<SeriesScan[]>(() => {
    try {
      const raw = localStorage.getItem("mochi_ambiguous_series");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [showVerdict, setShowVerdict] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [tmdbKey] = useState<string | null>(() => localStorage.getItem("mochi_tmdb_key"));
  const [proxyUrl] = useState<string | null>(() => localStorage.getItem("mochi_proxy_url"));
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { setBg } = useBackground();

  const fetchSeries = useCallback(() => {
    invoke<Series[]>("get_all_series")
      .then(setSeries)
      .catch(console.error);
  }, []);

  useEffect(() => { fetchSeries(); }, [fetchSeries]);

  // Refresh on data changes (scan complete, metadata fetch, type change)
  useEffect(() => {
    const handler = () => fetchSeries();
    window.addEventListener("mochi:data-changed", handler);
    return () => window.removeEventListener("mochi:data-changed", handler);
  }, [fetchSeries]);

  // ── Resume filter ─────────────────────────────────────────────────────
  useEffect(() => {
    if (filter !== "resume") return;
    invoke<{ id: number; series_id: number; episode_number: number } | null>("get_resume_episode")
      .then(setResumeEp)
      .catch(() => setResumeEp(null));
  }, [filter]);

  const filtered =
    filter === "resume"
      ? resumeEp
        ? series.filter((s) => s.id === resumeEp.series_id)
        : []
      : filter === "all"
      ? series
      : series.filter((s) => s.type === filter);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const selected = filtered[selectedIndex] ?? null;

  useEffect(() => {
    if (!selected) return;
    const gradient = GRADIENTS[selected.id % GRADIENTS.length];
    setBg({
      gradient,
      fanartPath: selected.fanart_path,
      maskGradient: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, var(--color-overlay) 60%, var(--color-overlay) 100%)",
    });
  }, [selected, setBg]);

  // ── Viscous scroll-to-card (spring-driven, replaces CSS snap) ─────────
  // mochi 滚动物理：低刚度 = 启停有质量感，高阻尼 = 粘滞包裹，无硬停止。
  // animate() 不支持 scrollLeft（DOM property 非 CSS），改用
  // MotionValue → useSpring → 手动写 scrollLeft。

  const scrollTarget = useMotionValue(containerRef.current?.scrollLeft ?? 0);
  const scrollSpring = useSpring(scrollTarget, {
    stiffness: 100,
    damping: 35,
  });
  const isProgrammaticRef = useRef(false);

  // 将弹簧值同步到 DOM scrollLeft
  useMotionValueEvent(scrollSpring, "change", (latest) => {
    if (!containerRef.current) return;
    isProgrammaticRef.current = true;
    containerRef.current.scrollLeft = latest;
    requestAnimationFrame(() => { isProgrammaticRef.current = false; });
  });

  const scrollToCard = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    const cards = container.children;
    const card = cards[index] as HTMLElement | undefined;
    if (!card) return;
    const target = card.offsetLeft + card.offsetWidth / 2 - container.clientWidth / 2;
    scrollTarget.set(target);
  }, [scrollTarget]);

  useLayoutEffect(() => {
    scrollToCard(selectedIndex);
  }, [selectedIndex, scrollToCard]);

  // ── Magnetic snap after free scrolling ───────────────────────────────

  const { scrollX } = useScroll({ container: containerRef });
  const snapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useMotionValueEvent(scrollX, "change", () => {
    if (snapTimeoutRef.current) clearTimeout(snapTimeoutRef.current);
    if (isProgrammaticRef.current) return;

    snapTimeoutRef.current = setTimeout(() => {
      const container = containerRef.current;
      if (!container || isProgrammaticRef.current) return;

      const cards = Array.from(container.children) as HTMLElement[];
      if (cards.length === 0) return;

      const viewCenter = container.scrollLeft + container.clientWidth / 2;
      let nearestIdx = 0;
      let nearestDist = Infinity;

      cards.forEach((card, i) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const dist = Math.abs(cardCenter - viewCenter);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      });

      if (nearestDist <= 30) {
        const card = cards[nearestIdx];
        const target = card.offsetLeft + card.offsetWidth / 2 - container.clientWidth / 2;
        scrollTarget.set(target);
        setSelectedIndex(nearestIdx);
      }
    }, 120);
  });

  // ── Jelly tag scaleX animation ────────────────────────────────────────
  // 在 filter-indicator 的 layoutId spring 之上叠加沿移动方向的 scaleX 变形。
  // 两个动画轨道作用于不同 CSS 属性（layoutId 管 x/y/w/h，scaleX 管 transform），不冲突。

  const jellyScaleX = useMotionValue(1);
  const jellyOriginX = useRef("50%");
  const prevFilter = useRef(filter);

  useEffect(() => {
    const newIdx = FILTERS.findIndex((f) => f.key === filter);
    const oldIdx = FILTERS.findIndex((f) => f.key === prevFilter.current);
    prevFilter.current = filter;

    if (oldIdx === newIdx || oldIdx < 0) return;

    const direction = newIdx > oldIdx ? 1 : -1;
    jellyOriginX.current = direction > 0 ? "0%" : "100%";

    // 阶段 1: 正向拉伸 (scaleX ≈ 1.08)
    jellyScaleX.set(1.08);

    const t1 = setTimeout(() => {
      // 阶段 2: 反向 undershoot (scaleX ≈ 0.95)
      jellyScaleX.set(0.95);
    }, 180);

    const t2 = setTimeout(() => {
      // 阶段 3: 回归原位
      jellyScaleX.set(1);
    }, 330);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // ── Keyboard + wheel ──────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept carousel keys when search is open
      if (showSearch) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "Enter" && selected) {
        if (filter === "resume" && resumeEp) {
          navigate(`/play/${resumeEp.id}`);
        } else {
          navigate(`/series/${selected.id}`);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered.length, selected, navigate, filter, resumeEp, showSearch]);

  // ── Search trigger ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowSearch(true);
      } else if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (filtered.length <= 1) return;
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      setSelectedIndex((i) => Math.max(0, Math.min(filtered.length - 1, i + (e.deltaX > 0 ? 1 : -1))));
    } else {
      setSelectedIndex((i) => Math.max(0, Math.min(filtered.length - 1, i + (e.deltaY > 0 ? 1 : -1))));
    }
  }, [filtered.length]);

  const outerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── No series at all (empty library) ──────────────────────────────────

  if (series.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-bg)",
          userSelect: "none",
        }}
      >
        {/* Settings gear — always visible */}
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 24px 0" }}>
          <motion.button
            onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
            className="flex items-center justify-center cursor-pointer bg-transparent border-none"
            whileHover={{ backgroundColor: "var(--color-surface-hover)" }}
            whileTap={{ scale: 0.92 }}
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "var(--color-surface)",
              fontSize: 16, color: "var(--color-text-muted)",
            }}
          >
            ⚙
          </motion.button>
        </div>
        {/* Center content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <BreathingDot size={24} />
          <motion.button
            onClick={onOpenSettings}
            whileHover={{ color: "var(--color-text-muted)" }}
            whileTap={{ scale: 0.96 }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--color-text-muted)", fontSize: 14,
            }}
          >
            + 添加媒体文件夹
          </motion.button>
          <span style={{ color: "var(--color-surface)", fontSize: 11 }}>
            或按 Ctrl+, 打开设置
          </span>
        </div>
      </motion.div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.page}
      style={{ width: "100%", height: "100%" }}
    >
      <div
        ref={outerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
        }}
      >
      <style>{`[data-scroll]::-webkit-scrollbar { display: none; }`}</style>

      {/* ── Filter bar ──────────────────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 0,
          right: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          userSelect: "none",
        }}
      >
        <div style={{ position: "relative", display: "flex", gap: 4 }}>
          {FILTERS.map((item) => {
            const isActive = item.key === filter;
            return (
              <motion.button
                key={item.key}
                onClick={() => {
                  setFilter(item.key);
                  setSelectedIndex(0);
                }}
                className="cursor-pointer bg-transparent border-none"
                whileHover={{
                  backgroundColor: isActive ? "var(--color-surface)" : "var(--color-surface-elevated)",
                }}
                whileTap={{ scale: 0.95 }}
                style={{
                  position: "relative",
                  height: 36,
                  padding: "0 16px",
                  borderRadius: 10,
                  fontSize: 13,
                  background: "transparent",
                  color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                  border: "none",
                }}
              >
                {isActive && (
                  <motion.div
                    layoutId="filter-indicator"
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "var(--color-surface)",
                      borderRadius: 10,
                      scaleX: jellyScaleX,
                      transformOrigin: `${jellyOriginX.current} 50%`,
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                  />
                )}
                <span style={{ position: "relative", zIndex: 1 }}>{item.label}</span>
              </motion.button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        {/* ── Search button ──────────────────────────────────────── */}
        <motion.button
          onClick={() => setShowSearch(true)}
          className="flex items-center justify-center cursor-pointer bg-transparent border-none"
          whileHover={{ backgroundColor: "var(--color-surface-hover)" }}
          whileTap={{ scale: 0.92 }}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--color-surface)",
            marginRight: 8,
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </motion.button>

        {/* ── Settings gear ─────────────────────────────────────────── */}
        <motion.button
          onClick={onOpenSettings}
          className="flex items-center justify-center cursor-pointer bg-transparent border-none"
          whileHover={{ backgroundColor: "var(--color-surface-hover)" }}
          whileTap={{ scale: 0.92 }}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--color-surface)",
            fontSize: 16,
            color: "var(--color-text-muted)",
          }}
        >
          ⚙
        </motion.button>
      </div>

      {/* ── Empty filtered state ─────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            userSelect: "none",
          }}
        >
          {/* 微微低头的 mochi 呼吸圆 — 不沮丧，只是歪头 */}
          <motion.div
            initial={{ rotate: 0 }}
            animate={{ rotate: -5 }}
            transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
          >
            <BreathingDot size={24} />
          </motion.div>
          <span style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
            {filter === "resume" ? "没有正在观看的剧集" : "换个标签试试？"}
          </span>
        </motion.div>
      ) : (
        <>
          {/* ── Poster carousel ──────────────────────────────────── */}
          <div
            style={{
              position: "absolute",
              top: "20%",
              left: 0,
              right: 0,
              zIndex: 1,
            }}
          >
            <div
              ref={containerRef}
              data-scroll
              style={{
                position: "relative",
                overflowX: "auto",
                overflowY: "visible",
                display: "flex",
                gap: "clamp(12px, 2vw, 32px)",
                padding: "clamp(12px, 2vw, 24px) calc(50% - clamp(55px, 7.5vw, 110px))",
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            >
              {filtered.map((s, i) => (
                <PosterCard
                  key={s.id}
                  s={s}
                  isActive={i === selectedIndex}
                  onClick={(_e: React.MouseEvent) => {
                    if (i === selectedIndex) {
                      if (filter === "resume" && resumeEp) {
                        navigate(`/play/${resumeEp.id}`);
                      } else {
                        navigate(`/series/${s.id}`);
                      }
                    } else {
                      setSelectedIndex(i);
                    }
                  }}
                />
              ))}
            </div>

            {/* ── Selected title (cross-fade) ─────────────────────── */}
            <AnimatePresence mode="wait">
              {selected && (
                <motion.div
                  key={selected.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    textAlign: "center",
                    marginTop: "clamp(8px, 1.5vw, 24px)",
                    fontSize: "clamp(14px, 2vw, 28px)",
                    fontWeight: 500,
                    color: "var(--color-text-secondary)",
                    userSelect: "none",
                  }}
                >
                  {selected.title}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Focus indicator dots ────────────────────────────── */}
            {filtered.length > 1 && (() => {
              const MAX_VISIBLE = 7;
              const showWindowed = filtered.length > MAX_VISIBLE;

              const visibleIndices: number[] = showWindowed
                ? (() => {
                    const half = Math.floor(MAX_VISIBLE / 2);
                    let start = selectedIndex - half;
                    if (start < 0) start = 0;
                    if (start > filtered.length - MAX_VISIBLE) start = filtered.length - MAX_VISIBLE;
                    return Array.from({ length: MAX_VISIBLE }, (_, i) => start + i);
                  })()
                : [];

              return (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    marginTop: "clamp(6px, 0.8vw, 12px)",
                    ...(showWindowed
                      ? {
                          width: MAX_VISIBLE * 24,
                          marginLeft: "auto",
                          marginRight: "auto",
                          overflow: "hidden",
                          maskImage:
                            "linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)",
                          WebkitMaskImage:
                            "linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)",
                        }
                      : {}),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 2,
                      ...(showWindowed ? { padding: "0 10px" } : {}),
                    }}
                  >
                    {(showWindowed ? visibleIndices : filtered.map((_, i) => i)).map(
                      (i) => {
                        const isActive = i === selectedIndex;
                        return (
                          <button
                            key={i}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIndex(i);
                            }}
                            aria-label={`跳转到第 ${i + 1} 项`}
                            style={{
                              width: 24,
                              height: 20,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              padding: 0,
                              flexShrink: 0,
                            }}
                          >
                            <motion.div
                              layout
                              animate={{
                                width: isActive ? 6 : 4,
                                height: isActive ? 6 : 4,
                                backgroundColor: isActive
                                  ? "var(--color-text-muted)"
                                  : "var(--color-border-light)",
                              }}
                              transition={spring.gentle}
                              style={{ borderRadius: "50%" }}
                            />
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}
      </div>

      {/* ── Verdict banner ────────────────────────────────────────── */}
      {ambiguousSeries.length > 0 && !showVerdict && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            position: "absolute",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
          }}
        >
          <motion.button
            onClick={() => setShowVerdict(true)}
            whileHover={{ backgroundColor: "var(--color-accent-dim)" }}
            whileTap={{ scale: 0.97 }}
            style={{
              padding: "10px 24px",
              borderRadius: 24,
              border: "1px solid var(--color-accent-dim)",
              background: "var(--color-modal-bg)",
              backdropFilter: "blur(12px)",
              color: "var(--color-accent)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {ambiguousSeries.length} 个新系列待确认 — 点击匹配
          </motion.button>
        </motion.div>
      )}

      {/* ── Verdict modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showVerdict && (
          <MetadataVerdict
            ambiguous={ambiguousSeries}
            tmdbApiKey={tmdbKey}
            proxyUrl={proxyUrl}
            onClose={() => setShowVerdict(false)}
            onResolved={() => {
              localStorage.removeItem("mochi_ambiguous_series");
              setAmbiguousSeries([]);
              // Refresh series list
              invoke<Series[]>("get_all_series")
                .then(setSeries)
                .catch(console.error);
            }}
          />
        )}
      </AnimatePresence>
      {/* ── Search overlay ──────────────────────────────────────── */}
      <AnimatePresence>
        {showSearch && (
          <SearchOverlay
            series={series}
            onClose={() => setShowSearch(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
