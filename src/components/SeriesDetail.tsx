import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Series, Episode } from "../types";
import { useImageSrc } from "../hooks/useImageSrc";
import { useBackground, GRADIENTS } from "../hooks/useBackground";

export default function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setBg } = useBackground();

  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [resumeEp, setResumeEp] = useState<Episode | null>(null);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [ready, setReady] = useState(false);

  const seriesId = id ? Number(id) : null;

  const reload = useCallback(() => {
    if (seriesId == null) return;
    invoke<Series | null>("get_series_by_id", { id: seriesId }).then(setSeries);
    invoke<Episode[]>("get_episodes_by_series", { seriesId }).then(setEpisodes);
  }, [seriesId]);

  useEffect(() => { reload(); }, [reload]);

  // Fetch resume episode from backend (more reliable than frontend array find)
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
      maskGradient: "linear-gradient(to top, rgba(14,14,14,0.92) 0%, rgba(14,14,14,0.6) 40%, rgba(14,14,14,0.25) 100%)",
    }));
  }, [series, setBg]);

  useEffect(() => {
    if (!series) { setReady(false); return; }
    const timer = setTimeout(() => setReady(true), 30);
    return () => clearTimeout(timer);
  }, [series]);

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
    ? (() => { try { return JSON.parse(series.genres); } catch { return []; } })()
    : [];
  const synopsisLong = (series?.synopsis?.length ?? 0) > 80;

  if (!series) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: "#0e0e0e" }}>
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>加载中…</span>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%", overflowY: "auto", overflowX: "hidden",
        opacity: ready ? 1 : 0, transition: "opacity 0.3s ease",
        scrollbarWidth: "none",
      }}
    >
      <style>{`div::-webkit-scrollbar { display: none; }`}</style>

      {/* ── Return button ─────────────────────────────────────────────── */}
      <button
        onClick={handleBack}
        className="flex items-center justify-center cursor-pointer bg-transparent border-none"
        style={{
          position: "fixed", top: 52, left: 16, zIndex: 60,
          width: 32, height: 32, borderRadius: "50%",
          background: "rgba(255,255,255,0.08)",
          fontSize: 16, color: "rgba(255,255,255,0.5)",
        }}
      >
        ←
      </button>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div style={{
        maxWidth: 720, margin: "0 auto",
        padding: "80px 24px 60px",
      }}>
        {/* Top: poster + title row */}
        <div style={{ display: "flex", gap: 28, marginBottom: 32 }}>
          <div
            onClick={handlePlay}
            style={{
              width: 140, height: 210, borderRadius: 8, flexShrink: 0,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              backgroundImage: posterSrc ? `url(${posterSrc})` : gradient,
              backgroundSize: "cover", backgroundPosition: "center",
              cursor: episodes.some((e) => e.status === "ready") ? "pointer" : "default",
              position: "relative", overflow: "hidden",
            }}
          >
            {!series.poster_path && (
              <span style={{
                position: "absolute", top: "50%", left: "50%",
                transform: "translate(-50%, -50%)",
                fontSize: 42, fontWeight: 700, color: "rgba(255,255,255,0.12)",
              }}>
                {initial}
              </span>
            )}
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(0,0,0,0.4)", opacity: 0, transition: "opacity 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; }}
            >
              <span style={{ fontSize: 36, color: "rgba(255,255,255,0.8)" }}>▶</span>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
            <h1 style={{
              fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.9)",
              margin: "0 0 8px", letterSpacing: -0.5, lineHeight: 1.3,
            }}>
              {series.display_name}
            </h1>

            {series.score != null && (
              <div style={{
                fontSize: 36, fontWeight: 700, color: "#c47e3a",
                lineHeight: 1, marginBottom: 8,
              }}>
                {(series.score / 10).toFixed(1)}
              </div>
            )}

            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>
              {[
                genres[0] ?? null,
                `${episodes.length} 集`,
                series.score ? `★${(series.score / 10).toFixed(1)}` : null,
                series.year?.toString(),
              ].filter(Boolean).join(" · ")}
            </div>

            {genres.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {genres.map((g) => (
                  <span key={g} style={{
                    fontSize: 11, padding: "3px 10px", borderRadius: 10,
                    background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)",
                  }}>
                    {g}
                  </span>
                ))}
              </div>
            )}

            {resumeEp ? (
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  onClick={() => navigate(`/play/${resumeEp.id}`)}
                  className="cursor-pointer border-none"
                  style={{
                    padding: "10px 36px", borderRadius: 22,
                    background: "rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.75)", fontSize: 15, fontWeight: 500,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
                >
                  继续 E{resumeEp.episode_number.toString().padStart(2, "0")}
                </button>
                {resumeEp.id !== firstEp?.id && (
                  <button
                    onClick={() => firstEp && navigate(`/play/${firstEp.id}`)}
                    className="cursor-pointer border-none"
                    style={{
                      fontSize: 12, opacity: 0.5,
                      color: "rgba(255,255,255,0.6)", background: "transparent",
                      padding: "6px 12px", borderRadius: 14,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                  >
                    从头开始
                  </button>
                )}
              </div>
            ) : firstEp ? (
              <button
                onClick={handlePlay}
                className="cursor-pointer border-none"
                style={{
                  padding: "10px 36px", borderRadius: 22,
                  background: "rgba(255,255,255,0.12)",
                  color: "rgba(255,255,255,0.75)", fontSize: 15, fontWeight: 500,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
              >
                播放
              </button>
            ) : (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>无可用剧集</span>
            )}
          </div>
        </div>

        {/* Synopsis */}
        {series.synopsis && (
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 14, color: "rgba(255,255,255,0.3)", lineHeight: 1.9,
              overflow: "hidden", display: "-webkit-box",
              WebkitLineClamp: synopsisExpanded ? "unset" : 3,
              WebkitBoxOrient: "vertical",
            }}>
              {series.synopsis}
            </div>
            {synopsisLong && (
              <button
                onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                style={{
                  fontSize: 12, color: "rgba(255,255,255,0.25)",
                  background: "none", border: "none", cursor: "pointer",
                  padding: "4px 0", marginTop: 4,
                }}
              >
                {synopsisExpanded ? "收起 ▲" : "展开 ▼"}
              </button>
            )}
          </div>
        )}

        {/* Episode list */}
        <div>
          <div style={{
            fontSize: 12, color: "rgba(255,255,255,0.2)",
            textTransform: "uppercase", letterSpacing: 2, marginBottom: 14,
          }}>
            剧集
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {episodes.map((ep) => {
              const disabled = ep.status === "downloading" || ep.status === "missing";
              const isWatched = ep.watched_completed;
              const bg = isWatched ? "rgba(90,170,150,0.12)" : "rgba(255,255,255,0.05)";
              const border = isWatched ? "rgba(90,170,150,0.2)" : "rgba(255,255,255,0.08)";
              const color = isWatched ? "rgba(90,170,150,0.6)" : "rgba(255,255,255,0.45)";
              return (
                <button
                  key={ep.id}
                  disabled={disabled}
                  onClick={() => { if (!disabled) navigate(`/play/${ep.id}`); }}
                  style={{
                    width: 56, height: 38, borderRadius: 8,
                    background: bg, border: `1px solid ${border}`, color,
                    fontSize: 13, cursor: disabled ? "default" : "pointer",
                    opacity: disabled ? 0.25 : 1,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled && !isWatched) e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = bg;
                  }}
                >
                  {ep.episode_number.toString().padStart(2, "0")}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
