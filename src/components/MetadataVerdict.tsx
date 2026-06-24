import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type { SeriesScan, BangumiSearchResult, TmdbSearchResult } from "../types";
import { BreathingDot } from "./BreathingDot";

interface Props {
  ambiguous: SeriesScan[];
  tmdbApiKey: string | null;
  proxyUrl: string | null;
  onClose: () => void;
  onResolved: () => void; // callback after all resolved/skipped, triggers rescan
}

interface VerdictCard {
  series: SeriesScan;
  status: "searching" | "loaded" | "confirming" | "skipped" | "resolved";
  bangumiResults: BangumiSearchResult[];
  tmdbResults: TmdbSearchResult[];
}

export default function MetadataVerdict({ ambiguous, tmdbApiKey, proxyUrl, onClose, onResolved }: Props) {
  const [cards, setCards] = useState<VerdictCard[]>(() =>
    ambiguous.map((s) => ({
      series: s,
      status: "searching" as const,
      bangumiResults: [],
      tmdbResults: [],
    }))
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [manualQuery, setManualQuery] = useState("");
  const [showManualSearch, setShowManualSearch] = useState(false);

  // ── Parallel search for each card ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    cards.forEach((card, i) => {
      if (card.status !== "searching") return;

      const searchTerm = card.series.search_term;

      // Search Bangumi
      const bgmPromise = invoke<BangumiSearchResult[]>("search_bangumi", {
        query: searchTerm,
        proxyUrl,
      }).catch(() => [] as BangumiSearchResult[]);

      // Search TMDB TV
      const tmdbPromise = tmdbApiKey
        ? invoke<TmdbSearchResult[]>("search_tmdb_tv", {
            query: searchTerm,
            tmdbApiKey,
            proxyUrl,
            language: "zh-CN",
            page: 1,
          }).catch(() => [] as TmdbSearchResult[])
        : Promise.resolve([] as TmdbSearchResult[]);

      Promise.all([bgmPromise, tmdbPromise]).then(([bgm, tmdb]) => {
        if (cancelled) return;
        setCards((prev) => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            status: "loaded",
            bangumiResults: bgm.slice(0, 5),
            tmdbResults: tmdb.slice(0, 5),
          };
          return next;
        });
      });
    });

    return () => {
      cancelled = true;
    };
    // Run only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = cards[currentIndex];
  const totalUnresolved = cards.filter((c) => c.status === "loaded" || c.status === "searching").length;

  // ── Actions ─────────────────────────────────────────────────────────

  const handleSelect = useCallback(
    async (source: "bangumi" | "tmdb", result: BangumiSearchResult | TmdbSearchResult) => {
      if (!current || current.status !== "loaded") return;

      setCards((prev) => {
        const next = [...prev];
        next[currentIndex] = { ...next[currentIndex], status: "confirming" };
        return next;
      });

      try {
        const s = current.series;
        if (source === "bangumi") {
          const bgm = result as BangumiSearchResult;
          await invoke("save_verdict", {
            folderPath: s.folder_path,
            folderName: s.folder_name,
            newType: "anime",
            bangumiId: bgm.id,
            tmdbId: null,
            mediaType: null,
            tmdbApiKey: tmdbApiKey,
            proxyUrl,
          });
        } else {
          const tmdb = result as TmdbSearchResult;
          const mediaType = tmdb.media_type === "movie" ? "movie" : "tv";
          await invoke("save_verdict", {
            folderPath: s.folder_path,
            folderName: s.folder_name,
            newType: mediaType,
            bangumiId: null,
            tmdbId: tmdb.id,
            mediaType,
            tmdbApiKey: tmdbApiKey,
            proxyUrl,
          });
        }

        setCards((prev) => {
          const next = [...prev];
          next[currentIndex] = { ...next[currentIndex], status: "resolved" };
          return next;
        });

        // Advance to next unresolved card
        const nextIdx = cards.findIndex(
          (c, idx) =>
            idx > currentIndex &&
            (c.status === "loaded" || c.status === "searching")
        );
        if (nextIdx >= 0) {
          setCurrentIndex(nextIdx);
        }
      } catch (err) {
        console.error("Verdict save failed:", err);
        setCards((prev) => {
          const next = [...prev];
          next[currentIndex] = { ...next[currentIndex], status: "loaded" };
          return next;
        });
      }
    },
    [current, currentIndex, cards, tmdbApiKey, proxyUrl]
  );

  const handleSkip = useCallback(() => {
    setCards((prev) => {
      const next = [...prev];
      next[currentIndex] = { ...next[currentIndex], status: "skipped" };
      return next;
    });
    const next = cards.findIndex(
      (c, idx) =>
        idx > currentIndex &&
        (c.status === "loaded" || c.status === "searching")
    );
    if (next >= 0) setCurrentIndex(next);
  }, [currentIndex, cards]);

  // ── Smart close: call onResolved if everything is done ────────────
  const handleClose = useCallback(() => {
    const allDone = cards.every(
      (c) => c.status === "resolved" || c.status === "skipped"
    );
    if (allDone) {
      onResolved();
    }
    onClose();
  }, [cards, onClose, onResolved]);

  const handleSkipAll = useCallback(() => {
    setCards((prev) => prev.map((c) => (c.status === "loaded" || c.status === "searching" ? { ...c, status: "skipped" } : c)));
    onClose();
    onResolved();
  }, [onClose, onResolved]);

  const handleConfirmAll = useCallback(async () => {
    // Save verdict for each loaded card
    const loadedCards = cards.filter((c) => c.status === "loaded");
    for (const card of loadedCards) {
      const s = card.series;
      const hasBgm = card.bangumiResults.length > 0;
      try {
        if (hasBgm) {
          const bgm = card.bangumiResults[0];
          await invoke("save_verdict", {
            folderPath: s.folder_path,
            folderName: s.folder_name,
            newType: "anime",
            bangumiId: bgm.id,
            tmdbId: null,
            mediaType: null,
            tmdbApiKey,
            proxyUrl,
          });
        } else if (card.tmdbResults.length > 0) {
          const tmdb = card.tmdbResults[0];
          const mediaType = tmdb.media_type === "movie" ? "movie" : "tv";
          await invoke("save_verdict", {
            folderPath: s.folder_path,
            folderName: s.folder_name,
            newType: mediaType,
            bangumiId: null,
            tmdbId: tmdb.id,
            mediaType,
            tmdbApiKey,
            proxyUrl,
          });
        }
      } catch (err) {
        console.error("批量确认失败:", s.folder_name, err);
      }
    }
    setCards((prev) =>
      prev.map((c) => {
        if (c.status !== "loaded") return c;
        return { ...c, status: "resolved" };
      })
    );
    onClose();
    onResolved();
  }, [cards, tmdbApiKey, proxyUrl, onClose, onResolved]);

  const handleManualSearch = useCallback(async () => {
    if (!manualQuery.trim() || !current) return;

    setCards((prev) => {
      const next = [...prev];
      next[currentIndex] = { ...next[currentIndex], status: "searching" };
      return next;
    });

    const bgmPromise = invoke<BangumiSearchResult[]>("search_bangumi", {
      query: manualQuery.trim(),
      proxyUrl,
    }).catch(() => [] as BangumiSearchResult[]);

    const tmdbPromise = tmdbApiKey
      ? invoke<TmdbSearchResult[]>("search_tmdb_tv", {
          query: manualQuery.trim(),
          tmdbApiKey,
          proxyUrl,
          language: "zh-CN",
          page: 1,
        }).catch(() => [] as TmdbSearchResult[])
      : Promise.resolve([] as TmdbSearchResult[]);

    const [bgm, tmdb] = await Promise.all([bgmPromise, tmdbPromise]);
    setCards((prev) => {
      const next = [...prev];
      next[currentIndex] = {
        ...next[currentIndex],
        status: "loaded",
        bangumiResults: bgm.slice(0, 5),
        tmdbResults: tmdb.slice(0, 5),
      };
      return next;
    });
    setShowManualSearch(false);
    setManualQuery("");
  }, [manualQuery, current, proxyUrl, tmdbApiKey, currentIndex]);

  // ── Keyboard ────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showManualSearch) {
          setShowManualSearch(false);
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose, showManualSearch]);

  if (cards.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(12px)",
      }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 80vw)",
          maxHeight: "80vh",
          background: "rgba(24,24,24,0.95)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>
              匹配元数据
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
              {totalUnresolved > 0
                ? `${totalUnresolved} 个系列待确认 · ${currentIndex + 1}/${cards.length}`
                : "全部已处理"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSkipAll}
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.35)",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: "6px 14px",
                cursor: "pointer",
              }}
            >
              全部跳过
            </button>
            <button
              onClick={handleConfirmAll}
              style={{
                fontSize: 12,
                color: "#c47e3a",
                background: "transparent",
                border: "1px solid rgba(196,126,58,0.3)",
                borderRadius: 8,
                padding: "6px 14px",
                cursor: "pointer",
              }}
            >
              批量确认
            </button>
          </div>
        </div>

        {/* Card area */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative", minHeight: 360 }}>
          {!current ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "rgba(255,255,255,0.2)",
                fontSize: 14,
              }}
            >
              全部已处理
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.2 }}
                style={{ padding: "20px 24px", height: "100%", overflowY: "auto" }}
              >
                {/* Series info */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.75)", marginBottom: 4 }}>
                    {current.series.display_name}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
                    {current.series.episodes.length} 个文件 · 文件夹: {current.series.folder_name}
                  </div>
                </div>

                {/* Loading state */}
                {current.status === "searching" && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 12,
                      padding: "60px 0",
                      color: "rgba(255,255,255,0.2)",
                      fontSize: 14,
                    }}
                  >
                    <BreathingDot size={16} />
                    正在搜索 Bangumi + TMDB…
                  </div>
                )}

                {/* Loaded: side-by-side results */}
                {current.status === "loaded" && (
                  <div style={{ display: "flex", gap: 16 }}>
                    {/* Bangumi column */}
                    <ResultColumn
                      label="Bangumi"
                      results={current.bangumiResults}
                      onSelect={(r) => handleSelect("bangumi", r)}
                    />
                    {/* TMDB column */}
                    <ResultColumn
                      label="TMDB"
                      results={current.tmdbResults}
                      onSelect={(r) => handleSelect("tmdb", r)}
                    />
                  </div>
                )}

                {/* Confirming / Resolved */}
                {(current.status === "confirming" || current.status === "resolved") && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 120,
                      color: current.status === "resolved" ? "rgba(90,170,150,0.6)" : "rgba(255,255,255,0.2)",
                      fontSize: 14,
                    }}
                  >
                    {current.status === "resolved" ? "✓ 已匹配" : <BreathingDot size={12} />}
                  </div>
                )}

                {/* Bottom actions */}
                {current.status === "loaded" && (
                  <div
                    style={{
                      marginTop: 20,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                      paddingTop: 16,
                    }}
                  >
                    <button
                      onClick={handleSkip}
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.35)",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 8px",
                      }}
                    >
                      跳过
                    </button>

                    <button
                      onClick={() => setShowManualSearch(!showManualSearch)}
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.3)",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 8px",
                      }}
                    >
                      以上都不对，手动搜索
                    </button>
                  </div>
                )}

                {/* Manual search box */}
                {showManualSearch && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    style={{ marginTop: 12, display: "flex", gap: 8 }}
                  >
                    <input
                      autoFocus
                      value={manualQuery}
                      onChange={(e) => setManualQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleManualSearch();
                      }}
                      placeholder="输入搜索词…"
                      style={{
                        flex: 1,
                        padding: "8px 14px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.1)",
                        background: "rgba(255,255,255,0.04)",
                        color: "rgba(255,255,255,0.7)",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={handleManualSearch}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 8,
                        border: "1px solid rgba(196,126,58,0.3)",
                        background: "transparent",
                        color: "#c47e3a",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      搜索
                    </button>
                  </motion.div>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* Progress dots */}
        <div
          style={{
            padding: "12px 24px 16px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {cards.map((card, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              style={{
                width: card.status === "resolved" ? 6 : card.status === "skipped" ? 5 : 8,
                height: card.status === "resolved" ? 6 : card.status === "skipped" ? 5 : 8,
                borderRadius: "50%",
                border: "none",
                cursor: "pointer",
                padding: 0,
                background:
                  i === currentIndex
                    ? "rgba(255,255,255,0.4)"
                    : card.status === "resolved"
                    ? "rgba(90,170,150,0.4)"
                    : card.status === "skipped"
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(255,255,255,0.1)",
                transition: "background 0.2s",
              }}
            />
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── ResultColumn ────────────────────────────────────────────────────────────

function ResultColumn({
  label,
  results,
  onSelect,
}: {
  label: string;
  results: (BangumiSearchResult | TmdbSearchResult)[];
  onSelect: (result: BangumiSearchResult | TmdbSearchResult) => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "rgba(255,255,255,0.2)",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      {results.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.15)",
            padding: "20px 0",
            textAlign: "center",
          }}
        >
          无匹配结果
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {results.map((r, i) => (
            <ResultCard key={i} result={r} onSelect={() => onSelect(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ResultCard ──────────────────────────────────────────────────────────────

function ResultCard({
  result,
  onSelect,
}: {
  result: BangumiSearchResult | TmdbSearchResult;
  onSelect: () => void;
}) {
  const title = "name_cn" in result ? (result.name_cn || result.name) : (result.title || result.name || "Unknown");
  const year = "air_date" in result
    ? result.air_date.slice(0, 4)
    : "release_date" in result && result.release_date
    ? result.release_date.slice(0, 4)
    : "first_air_date" in result && result.first_air_date
    ? result.first_air_date.slice(0, 4)
    : null;
  const score = "vote_average" in result && result.vote_average
    ? result.vote_average.toFixed(1)
    : null;

  return (
    <motion.button
      whileHover={{ backgroundColor: "rgba(255,255,255,0.06)" }}
      whileTap={{ scale: 0.98 }}
      onClick={onSelect}
      style={{
        display: "flex",
        gap: 10,
        padding: 10,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
        cursor: "pointer",
        textAlign: "left",
        color: "inherit",
        fontSize: "inherit",
      }}
    >
      <div
        style={{
          width: 48,
          height: 68,
          borderRadius: 6,
          flexShrink: 0,
          background: "rgba(255,255,255,0.05)",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "rgba(255,255,255,0.7)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginBottom: 4,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          {[year, score ? `★${score}` : null].filter(Boolean).join(" · ")}
        </div>
      </div>
    </motion.button>
  );
}
