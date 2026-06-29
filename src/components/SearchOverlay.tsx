import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import type { Series } from "../types";
import { spring } from "../animations/tokens";
import { useImageSrc } from "../hooks/useImageSrc";

const MAX_RESULTS = 8;
const DEBOUNCE_MS = 60;

const TYPE_LABEL: Record<string, string> = {
  anime: "动漫",
  tv: "影视",
  movie: "电影",
  variety: "综艺",
  unknown: "未知",
};

interface Props {
  series: Series[];
  onClose: () => void;
}

export default function SearchOverlay({ series, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [results, setResults] = useState<Series[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const navigate = useNavigate();

  // ── Filter with debounce ───────────────────────────────────────────

  const filterResults = useCallback(
    (q: string) => {
      if (q.trim() === "") {
        setResults([]);
        return;
      }
      const lower = q.toLowerCase();
      const matched = series.filter((s) => {
        if (s.title.toLowerCase().includes(lower)) return true;
        if (s.search_term.toLowerCase().includes(lower)) return true;
        if (s.year && s.year.toString().includes(lower)) return true;
        return false;
      });
      setResults(matched.slice(0, MAX_RESULTS));
    },
    [series],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    setSelectedIdx(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim() === "") {
      setResults([]);
    } else {
      debounceRef.current = setTimeout(() => filterResults(value), DEBOUNCE_MS);
    }
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // ── Auto-focus ─────────────────────────────────────────────────────

  useEffect(() => {
    // Small delay so the portal is mounted before focus
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // ── Keyboard ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = results[selectedIdx];
        if (target) {
          navigate(`/series/${target.id}`);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [results, selectedIdx, navigate, onClose]);

  // ── Ensure selectedIdx stays in bounds ─────────────────────────────

  useEffect(() => {
    if (selectedIdx >= results.length) {
      setSelectedIdx(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIdx]);

  return createPortal(
    <>
      {/* Backdrop */}
      <motion.div
        key="search-backdrop"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(6px)",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: "18vh",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 201,
          width: 420,
        }}
      >
        <motion.div
          key="search-panel"
          initial={{ scale: 0.96, opacity: 0, y: -4 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: -4 }}
          transition={spring.gentle}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "rgba(20,20,20,0.94)",
            backdropFilter: "blur(20px)",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.07)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* ── Input ──────────────────────────────────────────────── */}
          <div style={{ padding: "14px 14px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "0 14px",
                height: 44,
                borderRadius: 12,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="搜索系列…"
                spellCheck={false}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "rgba(255,255,255,0.85)",
                  fontSize: 15,
                  fontFamily: "inherit",
                }}
              />
              {query && (
                <button
                  onClick={() => handleChange("")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "rgba(255,255,255,0.25)",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* ── Results ────────────────────────────────────────────── */}
          {query.trim() !== "" && (
            <div
              style={{
                padding: "8px 6px 6px",
                maxHeight: 400,
                overflowY: "auto",
              }}
            >
              {results.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "28px 16px 22px",
                    color: "rgba(255,255,255,0.18)",
                    fontSize: 14,
                    userSelect: "none",
                  }}
                >
                  未找到匹配的系列
                </div>
              ) : (
                results.map((s, i) => (
                  <ResultRow
                    key={s.id}
                    series={s}
                    isActive={i === selectedIdx}
                    onClick={() => {
                      navigate(`/series/${s.id}`);
                      onClose();
                    }}
                    onHover={() => setSelectedIdx(i)}
                  />
                ))
              )}
            </div>
          )}

          {/* ── Footer hints ───────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              gap: 16,
              padding: "7px 16px",
              borderTop: "1px solid rgba(255,255,255,0.04)",
              fontSize: 11,
              color: "rgba(255,255,255,0.18)",
              userSelect: "none",
            }}
          >
            <span>↑↓ 导航</span>
            <span>Enter 打开</span>
            <span>Esc 关闭</span>
          </div>
        </motion.div>
      </div>
    </>,
    document.body,
  );
}

// ── Result row ────────────────────────────────────────────────────────────────

function ResultRow({
  series,
  isActive,
  onClick,
  onHover,
}: {
  series: Series;
  isActive: boolean;
  onClick: () => void;
  onHover: () => void;
}) {
  const posterSrc = useImageSrc(series.poster_path);
  const gradient = [
    "linear-gradient(135deg, #3a2a1a, #1a1a2e)",
    "linear-gradient(135deg, #2a3a2a, #1a1a2e)",
    "linear-gradient(135deg, #1a2a3a, #1a1a2e)",
  ][series.id % 3];

  return (
    <motion.button
      onClick={onClick}
      onMouseEnter={onHover}
      whileHover={{ backgroundColor: "rgba(255,255,255,0.06)" }}
      whileTap={{ scale: 0.985 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "7px 10px",
        borderRadius: 10,
        background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          width: 36,
          height: 54,
          borderRadius: 4,
          flexShrink: 0,
          backgroundImage: posterSrc ? `url(${posterSrc})` : gradient,
          backgroundSize: "cover",
          backgroundPosition: "center",
          overflow: "hidden",
        }}
      >
        {!posterSrc && (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              color: "rgba(255,255,255,0.12)",
              userSelect: "none",
            }}
          >
            {series.title.charAt(0)}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "rgba(255,255,255,0.85)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {series.title}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
          <span
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.3)",
              background: "rgba(255,255,255,0.06)",
              padding: "1px 6px",
              borderRadius: 4,
              lineHeight: "16px",
            }}
          >
            {TYPE_LABEL[series.type] || series.type}
          </span>
          {series.year && (
            <span
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.22)",
                lineHeight: "16px",
              }}
            >
              {series.year}
            </span>
          )}
        </div>
      </div>

      {/* Active indicator */}
      {isActive && (
        <div
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "rgba(196,126,58,0.5)",
            flexShrink: 0,
          }}
        />
      )}
    </motion.button>
  );
}
