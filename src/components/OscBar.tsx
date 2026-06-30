import { useRef, useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring } from "../animations/tokens";
import type { Track } from "../hooks/useMpv";
import type { OscTheme } from "../themes/oscThemes";
import { setOscMouseDown } from "../utils/oscDragState";
import {
  IconPrev,
  IconPlay,
  IconPause,
  IconNext,
  IconVolume,
  IconVolumeMute,
  IconEpisodes,
} from "./icons";

interface OscBarProps {
  timePos: number;
  duration: number;
  paused: boolean;
  speed: number;
  volume: number;
  episodeLabel: string;
  tracks: Track[];
  episodes: { id: number; episode_number: number; status: string; watched_completed: number }[];
  currentEpisodeId: number;
  onEpisodeSelect: (id: number) => void;
  onSeek: (sec: number) => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCycleSpeed: () => void;
  onSetVolume: (v: number) => void;
  onSetSubTrack: (id: number | null) => void;
  onSetAudioTrack: (id: number) => void;
  theme: OscTheme;
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function OscBar({
  timePos,
  duration,
  paused,
  speed,
  volume,
  episodeLabel,
  tracks,
  episodes,
  currentEpisodeId,
  onEpisodeSelect,
  onSeek,
  onTogglePlay,
  onPrev,
  onNext,
  onCycleSpeed,
  onSetVolume,
  onSetSubTrack,
  onSetAudioTrack,
  theme,
}: OscBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── OSC drag guard ────────────────────────────────────────────
  // Track whether a mousedown originated inside the OSC. When the user
  // drags a knob (timeline or volume) and releases the mouse outside
  // the OSC, the browser synthesises a click on the video area (the
  // common ancestor of mousedown/mouseup). We mark this and let
  // VideoPlayer consume + ignore that click.
  //
  // We use the capture phase so internal `e.stopPropagation()` calls
  // (e.g. in handleKnobMouseDown) don't shadow this listener.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const handleDown = (e: MouseEvent) => {
      if (el.contains(e.target as Node)) {
        setOscMouseDown(true);
      }
    };
    const handleUp = () => setOscMouseDown(false);
    el.addEventListener("mousedown", handleDown, true);
    window.addEventListener("mouseup", handleUp);
    return () => {
      el.removeEventListener("mousedown", handleDown, true);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  // --- Progress bar drag state ---
  const [isDragging, setIsDragging] = useState(false);
  const dragPreviewTimeRef = useRef(0);
  const [dragPreviewTime, setDragPreviewTime] = useState(0);
  const [dragPct, setDragPct] = useState(0);
  const suppressClickRef = useRef(false);

  const pct = duration > 0 ? (timePos / duration) * 100 : 0;

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const el = trackRef.current;
      if (!el || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  const handleKnobMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      suppressClickRef.current = true;
      setIsDragging(true);
      const el = trackRef.current;
      if (!el || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = ratio * duration;
      dragPreviewTimeRef.current = t;
      setDragPreviewTime(t);
      setDragPct(ratio * 100);
    },
    [duration],
  );

  useEffect(() => {
    if (!isDragging) return;
    const el = trackRef.current;

    const handleMove = (e: MouseEvent) => {
      if (!el || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = ratio * duration;
      dragPreviewTimeRef.current = t;
      setDragPreviewTime(t);
      setDragPct(ratio * 100);
    };

    const handleUp = () => {
      setIsDragging(false);
      onSeek(dragPreviewTimeRef.current);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging, duration, onSeek]);

  // --- Volume slider state ---
  const [showVolume, setShowVolume] = useState(false);
  const [isVolDragging, setIsVolDragging] = useState(false);
  const volTrackRef = useRef<HTMLDivElement>(null);
  const volBtnRef = useRef<HTMLButtonElement>(null);

  const calcVolume = useCallback((clientY: number) => {
    const el = volTrackRef.current;
    if (!el) return volume;
    const rect = el.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(130, (1 - (clientY - rect.top) / rect.height) * 130)));
  }, [volume]);

  const handleVolKnobDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsVolDragging(true);
      onSetVolume(calcVolume(e.clientY));
    },
    [calcVolume, onSetVolume],
  );

  useEffect(() => {
    if (!isVolDragging) return;
    const handleMove = (e: MouseEvent) => onSetVolume(calcVolume(e.clientY));
    const handleUp = () => {
      setIsVolDragging(false);
      setShowVolume(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isVolDragging, calcVolume, onSetVolume]);

  // --- Track menu state ---
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // --- Episode list state ---
  const [showEpisodes, setShowEpisodes] = useState(false);
  const epListRef = useRef<HTMLDivElement>(null);
  const epBtnRef = useRef<HTMLButtonElement>(null);

  // --- Hover expand state ---
  const [hoverTrack, setHoverTrack] = useState(false);

  useEffect(() => {
    if (!showMenu) return;
    const handleDown = (e: MouseEvent) => {
      if (
        menuRef.current?.contains(e.target as Node) ||
        menuBtnRef.current?.contains(e.target as Node)
      ) return;
      setShowMenu(false);
    };
    window.addEventListener("mousedown", handleDown);
    return () => window.removeEventListener("mousedown", handleDown);
  }, [showMenu]);

  useEffect(() => {
    if (!showEpisodes) return;
    const handleDown = (e: MouseEvent) => {
      if (
        epListRef.current?.contains(e.target as Node) ||
        epBtnRef.current?.contains(e.target as Node)
      ) return;
      setShowEpisodes(false);
    };
    window.addEventListener("mousedown", handleDown);
    return () => window.removeEventListener("mousedown", handleDown);
  }, [showEpisodes]);

  useEffect(() => {
    if (!showVolume) return;
    const handleDown = (e: MouseEvent) => {
      if (
        volTrackRef.current?.contains(e.target as Node) ||
        volBtnRef.current?.contains(e.target as Node)
      ) return;
      if (isVolDragging) return;
      setShowVolume(false);
    };
    window.addEventListener("mousedown", handleDown);
    return () => window.removeEventListener("mousedown", handleDown);
  }, [showVolume, isVolDragging]);

  // ── Mark body when any OSC float is open (for Esc priority) ──────
  const hasOpenFloat = showVolume || showMenu || showEpisodes;
  useEffect(() => {
    if (hasOpenFloat) {
      document.body.dataset.oscOverlay = "1";
    } else {
      delete document.body.dataset.oscOverlay;
    }
  }, [hasOpenFloat]);

  useEffect(() => {
    const handler = () => {
      setShowVolume(false);
      setShowMenu(false);
      setShowEpisodes(false);
    };
    window.addEventListener("mochi-osc-escape", handler);
    return () => window.removeEventListener("mochi-osc-escape", handler);
  }, []);

  const subtitleTracks = tracks.filter((t) => t.type === "sub");
  const audioTracks = tracks.filter((t) => t.type === "audio");

  const currentPct = isDragging ? dragPct : pct;

  const currentTrackHeight = isDragging
    ? theme.trackHeight + 2
    : hoverTrack && theme.hoverExpand
    ? theme.trackHeight + 2
    : theme.trackHeight;
  const knobSize = isDragging ? theme.knobSize + 2 : theme.knobSize;

  // --- Button style factory ---
  const btnStyle = (overrides: React.CSSProperties = {}): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    cursor: "pointer",
    background: theme.buttonBg,
    borderRadius: theme.buttonRadius,
    color: theme.textPrimary,
    ...overrides,
  });

  // --- Shared button components ---
  const PrevBtn = (
    <motion.button
      onClick={onPrev}
      whileHover={{ backgroundColor: theme.buttonHoverBg }}
      whileTap={{ scale: 0.92 }}
      transition={spring.gentle}
      style={btnStyle({ width: 34, height: 34 })}
    >
      <IconPrev size={12} />
    </motion.button>
  );

  const PlayBtn = (
    <motion.button
      onClick={onTogglePlay}
      whileHover={{ backgroundColor: theme.buttonHoverBg }}
      whileTap={{ scale: 0.88 }}
      transition={spring.press}
      style={btnStyle({ width: 40, height: 40 })}
    >
      {paused ? <IconPlay size={18} /> : <IconPause size={18} />}
    </motion.button>
  );

  const NextBtn = (
    <motion.button
      onClick={onNext}
      whileHover={{ backgroundColor: theme.buttonHoverBg }}
      whileTap={{ scale: 0.92 }}
      transition={spring.gentle}
      style={btnStyle({ width: 34, height: 34 })}
    >
      <IconNext size={12} />
    </motion.button>
  );

  const NowPlaying = theme.showNowPlaying ? (
    <div className="flex items-center gap-1.5 ml-1" style={{ fontSize: 12, color: theme.textSecondary }}>
      <span className="rounded-full" style={{ width: 5, height: 5, background: theme.accent }} />
      <span>{episodeLabel}</span>
    </div>
  ) : null;

  const Spacer = <div className="flex-1" />;

  const SpeedBtn = theme.showSpeedButton ? (
    <motion.button
      onClick={onCycleSpeed}
      whileHover={{ backgroundColor: theme.buttonHoverBg }}
      whileTap={{ scale: 0.92 }}
      transition={spring.gentle}
      style={btnStyle({ height: 34, padding: "0 14px", fontSize: 12 })}
    >
      {speed.toFixed(1)}×
    </motion.button>
  ) : null;

  const VolumeBtn = theme.showVolumeSlider ? (
    <div className="relative">
      <motion.button
        ref={volBtnRef}
        onClick={() => setShowVolume((v) => !v)}
        whileHover={{ backgroundColor: theme.buttonHoverBg }}
        whileTap={{ scale: 0.92 }}
        transition={spring.gentle}
        style={btnStyle({ width: 34, height: 34 })}
      >
        {volume === 0 ? <IconVolumeMute size={14} /> : <IconVolume size={14} />}
      </motion.button>
      <AnimatePresence>
        {showVolume && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginBottom: 8,
        }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 6 }}
            transition={spring.gentle}
            style={{
              width: 28,
              height: 90,
              background: "var(--color-overlay)",
              backdropFilter: "blur(8px)",
              borderRadius: 8,
              padding: "8px 0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 9, color: "var(--color-text-secondary)", textAlign: "center", marginBottom: 2 }}>
              {Math.round(volume)}
            </div>
            <div
              ref={volTrackRef}
              className="relative"
              style={{ width: 2, flex: 1, background: "var(--color-surface)", margin: "0 auto" }}
            >
              <div
                className="absolute left-0 right-0 bottom-0"
                style={{
                  height: `${(volume / 130) * 100}%`,
                  background: "var(--color-text-secondary)",
                }}
              />
              <motion.div
                className="absolute"
                animate={{ scale: isVolDragging ? 1.15 : 1, x: "-50%", y: "-50%" }}
                transition={spring.press}
                style={{
                  left: "50%",
                  top: `${(1 - volume / 130) * 100}%`,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#fff",
                  cursor: "grab",
                }}
                onMouseDown={handleVolKnobDown}
              />
            </div>
          </motion.div>
        </div>
        )}
      </AnimatePresence>
    </div>
  ) : null;

  const TrackMenuBtn = (
    <div className="relative">
      <motion.button
        ref={menuBtnRef}
        onClick={() => setShowMenu((v) => !v)}
        whileHover={{ backgroundColor: theme.buttonHoverBg }}
        whileTap={{ scale: 0.92 }}
        transition={spring.gentle}
        style={btnStyle({ width: 34, height: 34, fontSize: 12 })}
      >
        ⋮
      </motion.button>
      <AnimatePresence>
        {showMenu && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: 6, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.95 }}
          transition={spring.gentle}
          className="absolute"
          style={{
            bottom: "100%",
            right: 0,
            marginBottom: 8,
            background: "var(--color-overlay)",
            backdropFilter: "blur(12px)",
            borderRadius: 8,
            minWidth: 140,
            padding: 8,
            zIndex: 30,
          }}
        >
          {subtitleTracks.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", padding: "4px 8px" }}>
                字幕
              </div>
              <div
                onClick={() => { onSetSubTrack(null); setShowMenu(false); }}
                style={{
                  padding: "6px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  color: subtitleTracks.every((t) => !t.selected) ? "#fff" : "var(--color-text-muted)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-elevated)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                {subtitleTracks.every((t) => !t.selected) ? "• " : ""}关闭
              </div>
              {subtitleTracks.map((t) => (
                <div
                  key={`sub-${t.id}`}
                  onClick={() => { onSetSubTrack(t.id); setShowMenu(false); }}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    color: t.selected ? "#fff" : "var(--color-text-muted)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  {t.selected ? "• " : ""}{t.title}
                </div>
              ))}
            </>
          )}

          {audioTracks.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", padding: "4px 8px", marginTop: subtitleTracks.length > 0 ? 4 : 0 }}>
                音轨
              </div>
              {audioTracks.map((t) => (
                <div
                  key={`audio-${t.id}`}
                  onClick={() => { onSetAudioTrack(t.id); setShowMenu(false); }}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    color: t.selected ? "#fff" : "var(--color-text-muted)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  {t.selected ? "• " : ""}{t.title}
                </div>
              ))}
            </>
          )}

          {subtitleTracks.length === 0 && audioTracks.length === 0 && (
            <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--color-text-muted)" }}>
              无可用轨道
            </div>
          )}
        </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // --- Episode grid layout (always 5 columns) ---
  const EP_COLUMNS = 5;

  const EpisodeBtn = theme.showEpisodeButton && episodes.length > 1 ? (
    <div className="relative">
      <motion.button
        ref={epBtnRef}
        onClick={() => setShowEpisodes((v) => !v)}
        whileHover={{ backgroundColor: theme.buttonHoverBg }}
        whileTap={{ scale: 0.92 }}
        transition={spring.gentle}
        style={btnStyle({ width: 34, height: 34 })}
      >
        <IconEpisodes size={14} />
      </motion.button>
      <AnimatePresence>
        {showEpisodes && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          right: 0,
          marginBottom: 8,
          zIndex: 30,
        }}>
          <motion.div
            ref={epListRef}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={spring.gentle}
            style={{
              background: "var(--color-modal-bg)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderRadius: 14,
              border: "1px solid var(--color-surface)",
              padding: 12,
              boxShadow: "0 8px 32px var(--color-overlay), 0 2px 8px rgba(0,0,0,0.2)",
            }}
          >
            <style>{`.ep-osc-scroll::-webkit-scrollbar { width: 4px; } .ep-osc-scroll::-webkit-scrollbar-track { background: transparent; margin: 2px 0; } .ep-osc-scroll::-webkit-scrollbar-thumb { background: var(--color-surface-hover); border-radius: 2px; transition: background 0.2s; } .ep-osc-scroll::-webkit-scrollbar-thumb:hover { background: var(--color-text-muted); }`}</style>
            <div
              className="ep-osc-scroll"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${EP_COLUMNS}, 56px)`,
                gap: 8,
                maxHeight: 240,
                overflowY: "auto",
                scrollbarWidth: "thin",
                scrollbarColor: "var(--color-surface-hover) transparent",
              }}
            >
              {episodes.map((ep) => {
                const isCurrent = ep.id === currentEpisodeId;
                const isWatched = ep.watched_completed === 1;
                const disabled = ep.status === "downloading" || ep.status === "missing";

                let bg: string;
                let border: string;
                let color: string;

                if (isCurrent) {
                  bg = "var(--color-accent-dim)";
                  border = theme.accent;
                  color = "#fff";
                } else if (isWatched) {
                  bg = "rgba(90,170,150,0.12)";
                  border = "rgba(90,170,150,0.2)";
                  color = "rgba(90,170,150,0.6)";
                } else {
                  bg = "var(--color-surface-elevated)";
                  border = "var(--color-surface)";
                  color = "var(--color-text-muted)";
                }

                return (
                  <motion.button
                    key={ep.id}
                    disabled={disabled && !isCurrent}
                    onClick={() => { onEpisodeSelect(ep.id); setShowEpisodes(false); }}
                    whileHover={
                      !disabled
                        ? { scale: 1.06, backgroundColor: isCurrent ? undefined : "var(--color-surface)" }
                        : {}
                    }
                    whileTap={!disabled ? { scale: 0.93 } : {}}
                    transition={spring.gentle}
                    animate={{ opacity: disabled && !isCurrent ? 0.25 : 1 }}
                    style={{
                      width: 56,
                      height: 38,
                      borderRadius: 8,
                      background: bg,
                      border: `1px solid ${border}`,
                      color,
                      fontSize: 13,
                      fontWeight: isCurrent ? 600 : 400,
                      cursor: disabled && !isCurrent ? "default" : "pointer",
                    }}
                  >
                    {ep.episode_number.toString().padStart(2, "0")}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </div>
        )}
      </AnimatePresence>
    </div>
  ) : null;

  // --- Layouts ---
  const controlsRow =
    theme.layout === "centered" ? (
      /* centered: prev · play · next in center */
      <div className="flex items-center justify-center gap-2">
        {PrevBtn}
        {PlayBtn}
        {NextBtn}
        {NowPlaying}
      </div>
    ) : (
      /* spread:  left group | right group */
      <div className="flex items-center gap-1.5">
        {PrevBtn}
        {PlayBtn}
        {NextBtn}
        {NowPlaying}
        {Spacer}
        {SpeedBtn}
        {VolumeBtn}
        {TrackMenuBtn}
        {EpisodeBtn}
      </div>
    );

  const playingLabelBar =
    theme.layout === "centered" && theme.showNowPlaying ? (
      <div style={{
        textAlign: "center",
        fontSize: 11,
        color: theme.textSecondary,
        marginBottom: 6,
      }}>
        <span className="rounded-full inline-block" style={{ width: 5, height: 5, background: theme.accent, verticalAlign: "middle", marginRight: 6 }} />
        {episodeLabel}
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className="absolute bottom-0 left-0 right-0 flex flex-col gap-3.5"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        padding: theme.oscPadding,
        background: theme.oscGradient,
        borderRadius: "inherit",
      }}
    >
      {/* Playing label (centered layout only) */}
      {playingLabelBar}

      {/* Timeline row */}
      <div className="flex items-center gap-2.5">
        <span className="text-center font-tabular" style={{ fontSize: 10, color: theme.textSecondary, minWidth: 32 }}>
          {formatTime(isDragging ? dragPreviewTime : timePos)}
        </span>
        <div
          ref={trackRef}
          className="flex-1 relative cursor-pointer overflow-visible"
          style={{
            height: currentTrackHeight,
            background: theme.trackBg,
            borderRadius: currentTrackHeight,
            transition: isDragging ? "none" : "height 0.15s",
          }}
          onClick={handleTrackClick}
          onMouseEnter={() => setHoverTrack(true)}
          onMouseLeave={() => setHoverTrack(false)}
        >
          <div
            className="absolute left-0 top-0 bottom-0"
            style={{
              width: `${currentPct}%`,
              background: isDragging ? "var(--color-text-secondary)" : theme.playedBarColor,
              borderRadius: currentTrackHeight,
            }}
          />
          {isDragging && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${currentPct}%`,
                bottom: "100%",
                transform: "translateX(-50%)",
                marginBottom: 6,
                padding: "2px 6px",
                borderRadius: 4,
                background: "var(--color-overlay)",
                fontSize: 10,
                color: "var(--color-text-secondary)",
                whiteSpace: "nowrap",
              }}
            >
              {formatTime(dragPreviewTime)}
            </div>
          )}
          <motion.div
            className="absolute"
            animate={{ scale: isDragging ? 1.15 : 1, x: "-50%" }}
            transition={spring.press}
            style={{
              left: `${currentPct}%`,
              top: -(knobSize - currentTrackHeight) / 2,
              width: knobSize,
              height: knobSize,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              transition: isDragging ? "none" : "width 0.15s, height 0.15s, top 0.15s",
            }}
            onMouseDown={handleKnobMouseDown}
          />
        </div>
        <span className="text-center font-tabular" style={{ fontSize: 10, color: theme.textSecondary, minWidth: 32 }}>
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls row */}
      {controlsRow}
    </div>
  );
}
