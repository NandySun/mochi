import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Series } from "../types";
import { useImageSrc } from "../hooks/useImageSrc";
import { useBackground, GRADIENTS } from "../hooks/useBackground";

const FILTERS = [
  { key: "resume", label: "继续" },
  { key: "all", label: "全部" },
  { key: "anime", label: "动漫" },
  { key: "tv", label: "影视" },
] as const;

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
  const initial = s.display_name.charAt(0);

  return (
    <button
      data-series-id={s.id}
      onClick={onClick}
      className="cursor-pointer border-none"
      style={{
        width: "clamp(110px, 15vw, 220px)",
        height: "clamp(165px, 22.5vw, 330px)",
        borderRadius: 6,
        overflow: "visible",
        flexShrink: 0,
        scrollSnapAlign: "center",
        position: "relative",
        backgroundImage: posterSrc ? `url(${posterSrc})` : gradient,
        backgroundSize: "cover",
        backgroundPosition: "center",
        opacity: isActive ? 1 : 0.5,
        transform: isActive ? "scale(1.12)" : "scale(1)",
        boxShadow: isActive
          ? "0 0 24px rgba(196,126,58,0.35), 0 8px 32px rgba(0,0,0,0.5)"
          : "none",
        transition: "transform 0.3s, opacity 0.3s, box-shadow 0.3s",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.opacity = "0.75";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.opacity = "0.5";
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
            color: "rgba(255,255,255,0.15)",
            letterSpacing: 2,
          }}
        >
          {initial}
        </span>
      )}
    </button>
  );
}

export default function PosterWall({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [series, setSeries] = useState<Series[]>([]);
  const [filter, setFilter] = useState<"resume" | "all" | "anime" | "tv">("all");
  const [resumeEp, setResumeEp] = useState<{ id: number; series_id: number; episode_number: number } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { setBg } = useBackground();

  useEffect(() => {
    invoke<Series[]>("get_all_series")
      .then(setSeries)
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(timer);
  }, []);

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
      maskGradient: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.7) 100%)",
    });
  }, [selected, setBg]);

  const scrollToCard = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    const cards = container.children;
    const card = cards[index] as HTMLElement | undefined;
    if (!card) return;
    const target = card.offsetLeft + card.offsetWidth / 2 - container.clientWidth / 2;
    container.scrollTo({ left: target, behavior: "auto" });
  }, []);

  useLayoutEffect(() => {
    scrollToCard(selectedIndex);
  }, [selectedIndex, scrollToCard]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
  }, [filtered.length, selected, navigate]);

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


  // ── No series at all ────────────────────────────────────────────────────
  if (series.length === 0) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0e0e0e",
          color: "rgba(255,255,255,0.25)",
          fontSize: 14,
          userSelect: "none",
        }}
      >
        + 添加媒体文件夹
      </div>
    );
  }

  return (
    <div
      ref={outerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.25s ease",
      }}
    >
      <style>{`[data-scroll]::-webkit-scrollbar { display: none; }`}</style>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
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
        <div style={{ display: "flex", gap: 4 }}>
          {FILTERS.map((item) => {
            const isActive = item.key === filter;
            return (
              <button
                key={item.key}
                onClick={() => {
                  setFilter(item.key);
                  setSelectedIndex(0);
                }}
                className="cursor-pointer bg-transparent border-none"
                style={{
                  height: 36,
                  padding: "0 16px",
                  borderRadius: 10,
                  fontSize: 13,
                  background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                  color: isActive ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.42)",
                  transition: "background 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={onOpenSettings}
          className="flex items-center justify-center cursor-pointer bg-transparent border-none"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.08)",
            fontSize: 16,
            color: "rgba(255,255,255,0.45)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.14)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        >
          ⚙
        </button>
      </div>

      {/* ── Empty filtered state ─────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "rgba(255,255,255,0.2)",
            fontSize: 14,
            userSelect: "none",
          }}
        >
          {filter === "resume" ? "没有正在观看的剧集" : "没有匹配的系列"}
        </div>
      ) : (
        <>
          {/* ── Poster carousel ──────────────────────────────────────── */}
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
                scrollSnapType: "x mandatory",
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

            {/* ── Selected title ──────────────────────────────────────── */}
            {selected && (
              <div style={{
                textAlign: "center",
                marginTop: "clamp(8px, 1.5vw, 24px)",
                fontSize: "clamp(14px, 2vw, 28px)",
                fontWeight: 500,
                color: "rgba(255,255,255,0.7)",
                userSelect: "none",
              }}>
                {selected.display_name}
              </div>
            )}

            {/* ── Focus indicator dots ──────────────────────────────────── */}
            {filtered.length > 1 && (
              <div style={{
                display: "flex",
                justifyContent: "center",
                gap: "clamp(4px, 0.5vw, 6px)",
                marginTop: "clamp(6px, 0.8vw, 12px)",
              }}>
                {filtered.map((_, i) => (
                  <div key={i} style={{
                    width: i === selectedIndex ? 6 : 4,
                    height: i === selectedIndex ? 6 : 4,
                    borderRadius: "50%",
                    background: i === selectedIndex ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)",
                    transition: "all 0.2s",
                  }} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
