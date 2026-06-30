import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type { Series, Episode } from "../types";
import { useMpv } from "../hooks/useMpv";
import { escapeMpvOptionValue } from "../hooks/useMpv";
import { useFullscreen } from "../hooks/useFullscreen";
import { useBackground } from "../hooks/useBackground";
import OscBar from "./OscBar";
import { getTheme } from "../themes/oscThemes";
import { BreathingDot } from "./BreathingDot";
import { consumeOscMouseDown } from "../utils/oscDragState";

export default function VideoPlayer({ onFullscreenChange }: { onFullscreenChange?: (fs: boolean) => void }) {
  const { episodeId } = useParams<{ episodeId: string }>();
  const navigate = useNavigate();
  const { setBg } = useBackground();

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mpvReady = useRef(false);
  const playingRef = useRef(false);
  const lastSavedRef = useRef(0);
  const timePosRef = useRef(0);
  const volumeRef = useRef(0);
  const autoNextTriggeredRef = useRef(false);
  const hasPlayedNaturallyRef = useRef(false);
  const handlePrevRef = useRef<() => void>(() => {});
  const handleNextRef = useRef<() => void>(() => {});
  // Delays a single click to give dblclick a chance to land first. If a
  // second click arrives within `CLICK_DBLCLICK_WINDOW`, the pending
  // toggle is dropped so the dblclick handler runs alone.
  const clickTimerRef = useRef<number | null>(null);
  const CLICK_DBLCLICK_WINDOW = 250;
  // Drag detection: a mousedown that moves beyond DRAG_THRESHOLD pixels
  // before mouseup is treated as a drag, and the synthesised click is
  // discarded (no togglePlay). dragStartRef is reset to null after each
  // click handler runs.
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const wasDraggedRef = useRef(false);
  const DRAG_THRESHOLD = 5; // px

  const mpv = useMpv();
  const cycleSpeedRef = useRef(mpv.cycleSpeed);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const [oscThemeId, setOscThemeId] = useState(() => localStorage.getItem("mochi_osc_theme") ?? "mochi");
  const theme = getTheme(oscThemeId);

  useEffect(() => {
    const onThemeChange = () => setOscThemeId(localStorage.getItem("mochi_osc_theme") ?? "mochi");
    window.addEventListener("mochi-theme-changed", onThemeChange);
    return () => window.removeEventListener("mochi-theme-changed", onThemeChange);
  }, []);

  // Keep refs in sync with mpv state (avoids re-registering effects)
  timePosRef.current = mpv.timePos;
  volumeRef.current = mpv.volume;
  cycleSpeedRef.current = mpv.cycleSpeed;

  useEffect(() => { onFullscreenChange?.(isFullscreen); }, [isFullscreen, onFullscreenChange]);

  const epId = episodeId ? Number(episodeId) : null;

  // ── Data loading & playback start ──────────────────────────────────────
  useEffect(() => {
    if (epId == null) return;
    let cancelled = false;

    const init = async () => {
      try {
        setLoading(true);
        setErrorMsg(null);

        const ep = await invoke<Episode | null>("get_episode_by_id", { id: epId });
        if (cancelled || !ep) { if (!cancelled) setErrorMsg("剧集未找到"); return; }
        setEpisode(ep);

        const [s, eps] = await Promise.all([
          invoke<Series | null>("get_series_by_id", { id: ep.series_id }),
          invoke<Episode[]>("get_episodes_by_series", { seriesId: ep.series_id }),
        ]);
        if (cancelled) return;
        setSeries(s);
        setEpisodes(eps);

        // ── Background: transparent gradient, no fanart, light mask ────
        if (s) {
          setBg({
            gradient: "rgba(0,0,0,0)",
            fanartPath: null,
            maskGradient: "linear-gradient(to top, rgba(14,14,14,0.4) 0%, rgba(14,14,14,0.15) 40%, rgba(14,14,14,0.05) 100%)",
          });
        }

        // ── mpv ─────────────────────────────────────────────────────────
        if (!mpvReady.current) {
          await mpv.initMpv();
          if (cancelled) return;
          mpvReady.current = true;
        }

        const pathInfo = await invoke<{ file_path: string; fonts_dir: string | null } | null>(
          "get_episode_path", { episodeId: ep.id }
        );
        if (!pathInfo) {
          if (!cancelled) { setErrorMsg("文件路径未找到"); setLoading(false); }
          return;
        }
        const { file_path: filePath, fonts_dir: fontsDir } = pathInfo;

        mpv.observe(ep.id, ep.watched_progress);

        // Inject sub-fonts-dir at loadfile time so libass can find fonts in the
        // series-level fonts/ directory. Falls back to current behavior (no
        // sub-fonts-dir) when the series has no fonts/ directory or the option
        // is not supported by the embedded mpv build.
        const options = fontsDir
          ? ["replace", `sub-fonts-dir=${escapeMpvOptionValue(fontsDir)}`]
          : undefined;
        await mpv.loadFile(filePath, options);
        if (cancelled) return;

        // Load external subtitle files (parse JSON string from backend)
        if (ep.subtitle_paths) {
          const paths: string[] = typeof ep.subtitle_paths === 'string'
            ? JSON.parse(ep.subtitle_paths)
            : ep.subtitle_paths;
          if (Array.isArray(paths) && paths.length > 0) {
            mpv.loadSubtitleFiles(paths);
          }
        }

        hasPlayedNaturallyRef.current = false;
        autoNextTriggeredRef.current = false;

        // Refresh track list after file and external subs are loaded
        setTimeout(() => { mpv.refreshTracks(); }, 800);
        if (ep.subtitle_paths && ep.subtitle_paths.length > 0) {
          setTimeout(() => { mpv.refreshTracks(); }, 1600);
        }

        requestAnimationFrame(() => {
          const videoArea = document.querySelector("[data-mpv-area]") as HTMLElement | null;
          if (videoArea && !cancelled) {
            const rect = videoArea.getBoundingClientRect();
            const ww = window.innerWidth;
            const wh = window.innerHeight;
            mpv.setVideoMargins(rect.top / wh, (ww - rect.right) / ww, (wh - rect.bottom) / wh, rect.left / ww);
          }
        });

        setLoading(false);
      } catch (e) {
        if (!cancelled) { setErrorMsg(String(e).slice(0, 80)); setLoading(false); }
      } finally {
        playingRef.current = false;
      }
    };

    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epId]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (mpvReady.current) {
        mpv.cleanup();
        mpvReady.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Transparent html/body for mpv ──────────────────────────────────────
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
    };
  }, []);

  // ── Auto-hide controls (OSC + cursor) ───────────────────────────────
  const [showCtrls, setShowCtrls] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [alwaysAutoHide] = useState(
    () => localStorage.getItem("mochi_auto_hide_controls") !== "false"
  );

  const resetAutoHide = useCallback(() => {
    setShowCtrls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowCtrls(false), 3000);
  }, []);

  // Fullscreen: always auto-hide
  useEffect(() => {
    if (!isFullscreen) { setShowCtrls(true); return; }
    resetAutoHide();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [isFullscreen, resetAutoHide]);

  // Non-fullscreen: auto-hide if alwaysAutoHide enabled
  useEffect(() => {
    if (!alwaysAutoHide || isFullscreen) return;
    resetAutoHide();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [alwaysAutoHide, isFullscreen, resetAutoHide]);

  const controlsHidden = !showCtrls && (isFullscreen || alwaysAutoHide);

  // ── Video margins: fullscreen → zero; normal → ResizeObserver ──
  useEffect(() => {
    if (isFullscreen) {
      mpv.setVideoMargins(0, 0, 0, 0);
      return;
    }
    const el = document.querySelector("[data-mpv-area]") as HTMLElement | null;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const ww = window.innerWidth;
      const wh = window.innerHeight;
      mpv.setVideoMargins(rect.top / wh, (ww - rect.right) / ww, (wh - rect.bottom) / wh, rect.left / ww);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen, epId]);

  // ── Navigation ─────────────────────────────────────────────────────────
  const currentIndex = episodes.findIndex((e) => e.id === epId);
  const prevEp = currentIndex > 0 ? episodes[currentIndex - 1] : null;
  const nextEp = currentIndex >= 0 && currentIndex < episodes.length - 1 ? episodes[currentIndex + 1] : null;

  const goTo = (id: number) => navigate(`/play/${id}`, { replace: true });
  const saveAndGo = (id: number) => {
    if (epId && mpv.timePos > 0) {
      invoke("update_watch_progress", { episodeId: epId, progressSecs: Math.floor(mpv.timePos) }).catch(() => {});
    }
    goTo(id);
  };
  const handlePrev = () => { if (prevEp) saveAndGo(prevEp.id); };
  const handleNext = () => { if (nextEp) saveAndGo(nextEp.id); };
  handlePrevRef.current = handlePrev;
  handleNextRef.current = handleNext;

  // ── Video area: distinguish click from left-button drag ─────────
  // On mousedown we record the start position and arm a window-level
  // mousemove listener. If the cursor moves beyond DRAG_THRESHOLD
  // before mouseup, wasDraggedRef flips to true. The synthesised click
  // then bails out and does not toggle playback. The listener stays
  // attached for the lifetime of the player — it's a single mousemove
  // handler that no-ops when dragStartRef is null.
  const handleVideoAreaMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // left button only
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    wasDraggedRef.current = false;
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        wasDraggedRef.current = true;
      }
    };
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  // ── Video area click → toggle play (delayed to coalesce dblclick) ──
  const handleVideoAreaClick = useCallback(() => {
    // Drop clicks that were synthesised from a drag that started in the OSC
    if (consumeOscMouseDown()) {
      dragStartRef.current = null;
      wasDraggedRef.current = false;
      return;
    }
    // Drop the click if the press moved beyond the drag threshold — the
    // user was performing a left-button drag, not a click.
    if (wasDraggedRef.current) {
      dragStartRef.current = null;
      wasDraggedRef.current = false;
      return;
    }
    dragStartRef.current = null;
    // If a click is already pending, this is the second half of a dblclick
    // — drop it so the dblclick handler runs alone.
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      return;
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      mpv.togglePlay();
    }, CLICK_DBLCLICK_WINDOW);
  }, [mpv.togglePlay]);

  // Clear pending click timer on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
    };
  }, []);

  // ── Auto-play next episode ───────────────────────────────────────
  useEffect(() => {
    if (!mpv.duration || mpv.duration <= 0 || !nextEp) return;
    if (mpv.paused) return;

    // Natural play detection: playhead has passed the start zone
    if (mpv.timePos > 0 && mpv.timePos < 5) {
      hasPlayedNaturallyRef.current = true;
    }

    if (mpv.timePos >= mpv.duration - 3 && !autoNextTriggeredRef.current) {
      if (!hasPlayedNaturallyRef.current) return;
      autoNextTriggeredRef.current = true;
      goTo(nextEp.id);
    }
    if (mpv.timePos < 2) autoNextTriggeredRef.current = false;
  }, [mpv.timePos, mpv.duration, nextEp, mpv.paused]);

  const handleBack = async () => {
    if (epId && timePosRef.current > 0) {
      await invoke("update_watch_progress", { episodeId: epId, progressSecs: Math.floor(timePosRef.current) }).catch(() => {});
    }
    if (series) navigate(`/series/${series.id}`);
    else navigate("/");
  };

  // ── Progress auto-save (every 10s) ─────────────────────────────────
  useEffect(() => {
    if (!epId || !mpv.timePos || mpv.paused) return;
    const delta = Math.abs(mpv.timePos - lastSavedRef.current);
    if (delta < 10) return;
    lastSavedRef.current = mpv.timePos;
    invoke("update_watch_progress", { episodeId: epId, progressSecs: Math.floor(mpv.timePos) }).catch(() => {});
  }, [mpv.timePos, mpv.paused, epId]);

  // ── Save on close ───────────────────────────────────────────────────
  useEffect(() => {
    const save = () => {
      if (epId && mpv.timePos > 0) {
        invoke("update_watch_progress", { episodeId: epId, progressSecs: Math.floor(mpv.timePos) });
      }
    };
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, [epId, mpv.timePos]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          mpv.togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          mpv.seek(Math.max(0, timePosRef.current - 5));
          break;
        case "ArrowRight":
          e.preventDefault();
          mpv.seek(timePosRef.current + 5);
          break;
        case "ArrowUp":
          e.preventDefault();
          mpv.setVol(Math.min(130, volumeRef.current + 5));
          break;
        case "ArrowDown":
          e.preventDefault();
          mpv.setVol(Math.max(0, volumeRef.current - 5));
          break;
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "Escape":
          if (document.body.dataset.oscOverlay === "1") {
            window.dispatchEvent(new Event("mochi-osc-escape"));
          } else if (isFullscreen) {
            toggleFullscreen();
          } else {
            handleBack();
          }
          break;
        case "m":
        case "M":
          e.preventDefault();
          mpv.setVol(volumeRef.current > 0 ? 0 : 100);
          break;
        case "[":
          e.preventDefault();
          cycleSpeedRef.current();
          break;
        case "]":
          e.preventDefault();
          cycleSpeedRef.current();
          break;
        case "p":
        case "P":
          e.preventDefault();
          handlePrevRef.current();
          break;
        case "n":
        case "N":
          e.preventDefault();
          handleNextRef.current();
          break;
        case "j":
          e.preventDefault();
          mpv.cycleSub();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen, series, toggleFullscreen, mpv.togglePlay, mpv.seek, mpv.setVol]);

  // ── Derived ────────────────────────────────────────────────────────────
  const episodeLabel = episode
    ? `E${episode.episode_number.toString().padStart(2, "0")} · ${episode.title || ""}`
    : "";

  // ── Loading / Error ────────────────────────────────────────────────────
  if (!episode || loading) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
        <BreathingDot size={24} />
      </div>
    );
  }
  if (errorMsg) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--color-bg)", gap: 12 }}>
        <span style={{ color: "#f87171", fontSize: 13 }}>{errorMsg}</span>
        <button onClick={handleBack} style={{ color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>← 返回</button>
      </div>
    );
  }

  // ── Layout (fullscreen shares the same layout, native window handles sizing) ──
  return (
    <div
      onMouseMove={resetAutoHide}
      style={{
        height: "100%", display: "flex", flexDirection: "column", overflow: "hidden",
        cursor: controlsHidden ? "none" : "default",
      }}
    >
      {/* ── Top bar: back + episode label + fullscreen ──────────────── */}
      <motion.div
        animate={{ opacity: controlsHidden ? 0 : 1 }}
        transition={{ duration: 0.25 }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: isFullscreen ? "8px 16px 0" : "8px 12px 0", flexShrink: 0,
          pointerEvents: controlsHidden ? "none" : "auto",
        }}
      >
        <motion.button
          onClick={handleBack}
          className="flex items-center justify-center cursor-pointer bg-transparent border-none"
          whileHover={{ backgroundColor: "var(--color-surface-hover)" }}
          whileTap={{ scale: 0.92 }}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "var(--color-surface)", fontSize: 16, color: "var(--color-text-secondary)",
          }}
        >
          ←
        </motion.button>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{episodeLabel}</div>
        <motion.button
          onClick={toggleFullscreen}
          className="flex items-center justify-center cursor-pointer bg-transparent border-none"
          whileHover={{ backgroundColor: "var(--color-surface-hover)" }}
          whileTap={{ scale: 0.92 }}
          style={{
            width: 28, height: 28, borderRadius: 6,
            background: "var(--color-surface)", color: "var(--color-text-muted)",
          }}
        >
          {isFullscreen ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          )}
        </motion.button>
      </motion.div>

      {/* ── Video area ───────────────────────────────────────────────── */}
      <div
        data-mpv-area
        onMouseDown={handleVideoAreaMouseDown}
        onClick={handleVideoAreaClick}
        onDoubleClick={toggleFullscreen}
        style={{
          flex: 1, minWidth: 0,
          background: "transparent", position: "relative",
          borderRadius: isFullscreen ? 0 : 10, overflow: "hidden",
          margin: isFullscreen ? 0 : "8px 12px 12px 12px",
        }}
      >
        <motion.div
          animate={{ opacity: controlsHidden ? 0 : 1 }}
          transition={{ duration: 0.25 }}
          style={{ pointerEvents: controlsHidden ? "none" : "auto" }}
        >
          <OscBar
            key={theme.id}
            theme={theme}
            timePos={mpv.timePos} duration={mpv.duration}
            paused={mpv.paused} speed={mpv.speed} volume={mpv.volume}
            episodeLabel={episodeLabel} tracks={mpv.tracks}
            onSeek={mpv.seek} onTogglePlay={mpv.togglePlay}
            onPrev={handlePrev} onNext={handleNext}
            onCycleSpeed={mpv.cycleSpeed} onSetVolume={mpv.setVol}
            onSetSubTrack={mpv.setSubTrack} onSetAudioTrack={mpv.setAudioTrack}
            episodes={episodes}
            currentEpisodeId={epId ?? 0}
            onEpisodeSelect={(id) => saveAndGo(id)}
          />
        </motion.div>
      </div>
    </div>
  );
}
