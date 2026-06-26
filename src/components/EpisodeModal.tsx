import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import type { Episode } from "../types";
import { useImageSrc } from "../hooks/useImageSrc";

// ── Thumbnail gradient variants ────────────────────────────────────────

const GRADIENTS = [
  "linear-gradient(135deg, #1a1a2e 30%, #2a1a1a 100%)",
  "linear-gradient(135deg, #1a2a1e 30%, #1a1a2e 100%)",
  "linear-gradient(135deg, #2e1a1a 30%, #1a1a2e 100%)",
  "linear-gradient(135deg, #1a1a2e 30%, #1e1a2a 100%)",
  "linear-gradient(135deg, #1e2a1a 30%, #1a2a1e 100%)",
  "linear-gradient(135deg, #2a1e2a 30%, #1a1a2e 100%)",
  "linear-gradient(135deg, #1a2a2e 30%, #1a1e2a 100%)",
  "linear-gradient(135deg, #2a1a1e 30%, #1e2a1a 100%)",
  "linear-gradient(135deg, #1e1a2e 30%, #2a1e1a 100%)",
  "linear-gradient(135deg, #1a2e1a 30%, #1a1a2e 100%)",
];

// ── EpisodeModal ────────────────────────────────────────────────────────

interface EpisodeModalProps {
  episodes: Episode[];
  resumeEpId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onPlay: (epId: number) => void;
}

export default function EpisodeModal({
  episodes,
  resumeEpId,
  isOpen,
  onClose,
  onPlay,
}: EpisodeModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [season, setSeason] = useState<number>(1);
  const [ascending, setAscending] = useState(true);

  // Derive season list from episodes
  const seasons = [
    ...new Set(episodes.map((ep) => ep.season_number)),
  ].sort((a, b) => a - b);

  // Reset season on open
  useEffect(() => {
    if (isOpen && seasons.length > 0) setSeason(seasons[0]);
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleMaskClick = useCallback(
    (e: React.MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  // Filtered + sorted episodes
  const filtered = (() => {
    const list = episodes
      .filter((ep) => ep.season_number === season)
      .sort((a, b) => a.episode_number - b.episode_number);
    return ascending ? list : [...list].reverse();
  })();

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={handleMaskClick}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 200,
              background: "rgba(0,0,0,0.4)",
            }}
          />

          {/* Modal outer wrapper — pure CSS centering, untouched by framer-motion transform */}
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 210,
              width: `min(680px, calc(100vw - 40px))`,
              maxHeight: "78vh",
            }}
          >
            <motion.div
              ref={modalRef}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.28, ease: [0.34, 1.4, 0.64, 1] }}
              style={{
                width: "100%",
                maxHeight: "78vh",
                background: "#1a1714",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14,
                boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
                display: "flex",
                flexDirection: "column",
              }}
            >
            <style>{`.ep-modal-body::-webkit-scrollbar { width:3px; } .ep-modal-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); border-radius:3px; }`}</style>

            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(232,228,223,0.9)" }}>
                  全部剧集 · 第 {season} 季
                </span>

                {/* Season selector */}
                {seasons.length > 1 && (
                  <div style={{ display: "flex", gap: 4 }}>
                    {seasons.map((s) => {
                      const isActive = s === season;
                      return (
                        <button
                          key={s}
                          onClick={() => setSeason(s)}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: 4,
                            border: "none",
                            cursor: "pointer",
                            background: isActive ? "#c47e3a" : "rgba(255,255,255,0.06)",
                            color: isActive ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.35)",
                            transition: "all 0.2s",
                            fontFamily: "inherit",
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) {
                              (e.target as HTMLElement).style.background = "rgba(255,255,255,0.1)";
                              (e.target as HTMLElement).style.color = "rgba(255,255,255,0.55)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) {
                              (e.target as HTMLElement).style.background = "rgba(255,255,255,0.06)";
                              (e.target as HTMLElement).style.color = "rgba(255,255,255,0.35)";
                            }
                          }}
                        >
                          S{s}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Sort order toggle */}
                <span
                  onClick={() => setAscending(!ascending)}
                  title={ascending ? "正序" : "逆序"}
                  style={{
                    fontSize: 12,
                    color: "rgba(232,228,223,0.33)",
                    cursor: "pointer",
                    userSelect: "none",
                    padding: "2px 6px",
                    transition: "color 0.2s",
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "rgba(232,228,223,0.7)"; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "rgba(232,228,223,0.33)"; }}
                >
                  {ascending ? "↑" : "↓"}
                </span>
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.06)",
                  border: "none",
                  color: "rgba(255,255,255,0.35)",
                  cursor: "pointer",
                  fontSize: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Body: 3-column grid */}
            <div
              className="ep-modal-body"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 16,
              }}
            >
              {filtered.map((ep) => (
                <EpisodeCard
                  key={ep.id}
                  episode={ep}
                  isResume={ep.id === resumeEpId}
                  onPlay={onPlay}
                />
              ))}
              {filtered.length === 0 && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    textAlign: "center",
                    padding: 40,
                    fontSize: 13,
                    color: "rgba(255,255,255,0.2)",
                  }}
                >
                  暂无剧集
                </div>
              )}
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ── Episode Card ────────────────────────────────────────────────────────

function EpisodeCard({
  episode,
  isResume,
  onPlay,
}: {
  episode: Episode;
  isResume: boolean;
  onPlay: (id: number) => void;
}) {
  const stillSrc = useImageSrc(episode.still_path ?? null);
  const gradient = GRADIENTS[(episode.episode_number - 1) % GRADIENTS.length];
  const isWatched = !!episode.watched_completed;

  const formatDuration = (mins: number | null): string => {
    if (!mins) return "";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <motion.div
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onPlay(episode.id)}
      style={{
        cursor: "pointer",
        opacity: isWatched ? 0.5 : 1,
        minWidth: 0,
      }}
    >
      {/* Thumbnail — fixed 16:9 via padding-bottom */}
      <div
        style={{
          width: "100%",
          paddingBottom: "56.25%",
          borderRadius: 6,
          position: "relative",
          overflow: "hidden",
          outline: isResume ? "2px solid #c47e3a" : undefined,
          outlineOffset: 2,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: stillSrc ? `url(${stillSrc})` : gradient,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        {/* Episode number overlay */}
        <span
          style={{
            position: "absolute",
            top: 5,
            left: 6,
            background: "rgba(0,0,0,0.55)",
            color: "rgba(255,255,255,0.85)",
            fontSize: 9,
            padding: "1px 5px",
            borderRadius: 3,
            fontWeight: 600,
          }}
        >
          E{episode.episode_number.toString().padStart(2, "0")}
        </span>

        {/* Watched checkmark */}
        {isWatched && (
          <span
            style={{
              position: "absolute",
              bottom: 5,
              right: 6,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#4a9e5c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              color: "#fff",
            }}
          >
            ✓
          </span>
        )}
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          marginTop: 6,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: "rgba(232,228,223,0.7)",
        }}
        title={episode.title ?? undefined}
      >
        {episode.title ?? `第 ${episode.episode_number} 集`}
      </div>

      {/* Meta: duration + resume label */}
      <div
        style={{
          fontSize: 11,
          color: isResume ? "#c47e3a" : "rgba(232,228,223,0.33)",
          marginTop: 2,
        }}
      >
        {isResume ? "继续观看" : formatDuration(episode.runtime)}
      </div>
    </motion.div>
  );
}
