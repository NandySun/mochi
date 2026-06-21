import { useRef, useState, useCallback, useEffect } from "react";
import type { Track } from "../hooks/useMpv";
import type { OscTheme } from "../themes/oscThemes";

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

  // --- Volume hover slider state ---
  const [showVolume, setShowVolume] = useState(false);
  const [isVolDragging, setIsVolDragging] = useState(false);
  const volTrackRef = useRef<HTMLDivElement>(null);
  const volumeHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showVolumeSlider = useCallback(() => {
    if (volumeHoverTimer.current) clearTimeout(volumeHoverTimer.current);
    setShowVolume(true);
  }, []);

  const scheduleHideVolume = useCallback(() => {
    if (volumeHoverTimer.current) clearTimeout(volumeHoverTimer.current);
    volumeHoverTimer.current = setTimeout(() => {
      if (!isVolDragging) setShowVolume(false);
    }, 300);
  }, [isVolDragging]);

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

  const hoverBtn = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = theme.buttonHoverBg;
  };
  const leaveBtn = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = theme.buttonBg;
  };

  // --- Shared button components ---
  const PrevBtn = (
    <button
      onClick={onPrev}
      style={btnStyle({ width: 34, height: 34, fontSize: 12 })}
      onMouseEnter={hoverBtn}
      onMouseLeave={leaveBtn}
    >
      ⏮
    </button>
  );

  const PlayBtn = (
    <button
      onClick={onTogglePlay}
      style={btnStyle({ width: 40, height: 40, fontSize: 16 })}
      onMouseEnter={hoverBtn}
      onMouseLeave={leaveBtn}
    >
      {paused ? "▶" : "⏸"}
    </button>
  );

  const NextBtn = (
    <button
      onClick={onNext}
      style={btnStyle({ width: 34, height: 34, fontSize: 12 })}
      onMouseEnter={hoverBtn}
      onMouseLeave={leaveBtn}
    >
      ⏭
    </button>
  );

  const NowPlaying = theme.showNowPlaying ? (
    <div className="flex items-center gap-1.5 ml-1" style={{ fontSize: 12, color: theme.textSecondary }}>
      <span className="rounded-full" style={{ width: 5, height: 5, background: theme.accent }} />
      <span>{episodeLabel}</span>
    </div>
  ) : null;

  const Spacer = <div className="flex-1" />;

  const SpeedBtn = theme.showSpeedButton ? (
    <button
      onClick={onCycleSpeed}
      style={btnStyle({ height: 34, padding: "0 14px", fontSize: 12 })}
      onMouseEnter={hoverBtn}
      onMouseLeave={leaveBtn}
    >
      {speed.toFixed(1)}×
    </button>
  ) : null;

  const VolumeBtn = theme.showVolumeSlider ? (
    <div
      className="relative"
      onMouseEnter={showVolumeSlider}
      onMouseLeave={scheduleHideVolume}
    >
      <button
        onClick={() => onSetVolume(volume === 0 ? 100 : 0)}
        style={btnStyle({ width: 34, height: 34, fontSize: 12 })}
        onMouseEnter={hoverBtn}
        onMouseLeave={leaveBtn}
      >
        {volume === 0 ? "🔇" : "🔊"}
      </button>
      {showVolume && (
        <div
          className="absolute"
          style={{
            bottom: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginBottom: 8,
            width: 28,
            height: 90,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            borderRadius: 8,
            padding: "8px 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", textAlign: "center", marginBottom: 2 }}>
            {Math.round(volume)}
          </div>
          <div
            ref={volTrackRef}
            className="relative"
            style={{ width: 2, flex: 1, background: "rgba(255,255,255,0.1)", margin: "0 auto" }}
          >
            <div
              className="absolute left-0 right-0 bottom-0"
              style={{
                height: `${(volume / 130) * 100}%`,
                background: "rgba(255,255,255,0.5)",
              }}
            />
            <div
              className="absolute"
              style={{
                left: "50%",
                bottom: `${(volume / 130) * 100}%`,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#fff",
                transform: "translate(-50%, 50%)",
                cursor: "grab",
              }}
              onMouseDown={handleVolKnobDown}
            />
          </div>
        </div>
      )}
    </div>
  ) : null;

  const TrackMenuBtn = (
    <div className="relative">
      <button
        ref={menuBtnRef}
        onClick={() => setShowMenu((v) => !v)}
        style={btnStyle({ width: 34, height: 34, fontSize: 12 })}
        onMouseEnter={hoverBtn}
        onMouseLeave={leaveBtn}
      >
        ⋮
      </button>
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute"
          style={{
            bottom: "100%",
            right: 0,
            marginBottom: 8,
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(12px)",
            borderRadius: 8,
            minWidth: 140,
            padding: 8,
            zIndex: 30,
          }}
        >
          {subtitleTracks.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", padding: "4px 8px" }}>
                字幕
              </div>
              <div
                onClick={() => { onSetSubTrack(null); setShowMenu(false); }}
                style={{
                  padding: "6px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  color: subtitleTracks.every((t) => !t.selected) ? "#fff" : "rgba(255,255,255,0.45)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
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
                    color: t.selected ? "#fff" : "rgba(255,255,255,0.45)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  {t.selected ? "• " : ""}{t.title}
                </div>
              ))}
            </>
          )}

          {audioTracks.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", padding: "4px 8px", marginTop: subtitleTracks.length > 0 ? 4 : 0 }}>
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
                    color: t.selected ? "#fff" : "rgba(255,255,255,0.45)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  {t.selected ? "• " : ""}{t.title}
                </div>
              ))}
            </>
          )}

          {subtitleTracks.length === 0 && audioTracks.length === 0 && (
            <div style={{ padding: "6px 8px", fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
              无可用轨道
            </div>
          )}
        </div>
      )}
    </div>
  );

  const EpisodeBtn = theme.showEpisodeButton && episodes.length > 1 ? (
    <div className="relative">
      <button
        ref={epBtnRef}
        onClick={() => setShowEpisodes((v) => !v)}
        style={btnStyle({ width: 34, height: 34, fontSize: 12 })}
        onMouseEnter={hoverBtn}
        onMouseLeave={leaveBtn}
      >
        📋
      </button>
      {showEpisodes && (
        <div
          ref={epListRef}
          className="absolute"
          style={{
            bottom: "100%",
            right: 0,
            marginBottom: 8,
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(12px)",
            borderRadius: 10,
            padding: 10,
            zIndex: 30,
            maxWidth: 360,
          }}
        >
          <div style={{
            display: "flex", gap: 8,
            overflowX: "auto",
            scrollbarWidth: "none",
          }}>
            {episodes.map((ep) => {
              const isCurrent = ep.id === currentEpisodeId;
              const disabled = ep.status === "downloading" || ep.status === "missing";
              let bg = "rgba(255,255,255,0.08)";
              let color = "rgba(255,255,255,0.5)";
              if (isCurrent) { bg = theme.accent; color = "#fff"; }
              else if (ep.watched_completed) { bg = "rgba(76,175,80,0.15)"; color = "rgba(129,199,132,0.7)"; }
              return (
                <button
                  key={ep.id}
                  disabled={disabled && !isCurrent}
                  onClick={() => { onEpisodeSelect(ep.id); setShowEpisodes(false); }}
                  style={{
                    minWidth: 40, height: 34,
                    borderRadius: 7,
                    background: bg,
                    border: isCurrent ? `1px solid ${theme.accent}` : "1px solid transparent",
                    color,
                    fontSize: 13, fontWeight: isCurrent ? 600 : 400,
                    cursor: disabled ? "default" : "pointer",
                    opacity: disabled ? 0.35 : 1,
                    flexShrink: 0,
                    padding: "0 10px",
                  }}
                >
                  {ep.episode_number.toString().padStart(2, "0")}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
      className="absolute bottom-0 left-0 right-0 flex flex-col gap-3.5"
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
              background: isDragging ? "rgba(255,255,255,0.7)" : theme.playedBarColor,
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
                background: "rgba(0,0,0,0.75)",
                fontSize: 10,
                color: "rgba(255,255,255,0.7)",
                whiteSpace: "nowrap",
              }}
            >
              {formatTime(dragPreviewTime)}
            </div>
          )}
          <div
            className="absolute"
            style={{
              left: `${currentPct}%`,
              top: -(knobSize - currentTrackHeight) / 2,
              width: knobSize,
              height: knobSize,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              transform: "translateX(-50%)",
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
