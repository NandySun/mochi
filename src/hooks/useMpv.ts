import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  MpvConfig,
  init,
  observeProperties,
  command,
  getProperty,
  setProperty,
  setVideoMarginRatio,
  MpvObservableProperty,
} from "tauri-plugin-libmpv-api";

export type Track = {
  id: number;
  type: "sub" | "audio";
  title: string;
  selected: boolean;
};

const OBSERVED_PROPERTIES = [
  ["pause", "flag"],
  ["time-pos", "double", "none"],
  ["duration", "double", "none"],
] as const satisfies MpvObservableProperty[];

// ── Module-level singleton init ──────────────────────────────────────────
// mpv is initialised once and never destroyed until the app exits.
// Destroying/recreating the native mpv context on every detail-page unmount
// races with the next init() and causes a native crash.
let globalInitPromise: Promise<string> | null = null;

function ensureMpv(): Promise<string> {
  if (globalInitPromise) return globalInitPromise;

  const mpvConfig: MpvConfig = {
    initialOptions: {
      "vo": "gpu-next",
      "hwdec": "auto-safe",
      "keep-open": "yes",
      "force-window": "yes",
    },
    observedProperties: OBSERVED_PROPERTIES,
  };

  globalInitPromise = init(mpvConfig).catch((e) => {
    globalInitPromise = null; // allow retry on next attempt
    throw e;
  });

  return globalInitPromise;
}

export function useMpv() {
  const [timePos, setTimePos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1.0);
  const [tracks, setTracks] = useState<Track[]>([]);
  const progressSaveRef = useRef(0);
  const episodeIdRef = useRef<number>(0);
  const resumeSecsRef = useRef(0);
  const resumeDoneRef = useRef(false);
  const timePosRef = useRef(0);
  const unlistenRef = useRef<(() => void) | null>(null);

  const initMpv = useCallback(async () => {
    await ensureMpv();
  }, []);

  const observe = useCallback(
    (episodeId: number, onResumeSecs?: number) => {
      episodeIdRef.current = episodeId;
      resumeSecsRef.current = onResumeSecs && onResumeSecs > 0 ? onResumeSecs : 0;
      resumeDoneRef.current = false;

      // Unlisten previous observer before registering a new one
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      observeProperties(OBSERVED_PROPERTIES, ({ name, data }) => {
        switch (name) {
          case "pause":
            setPaused(data as boolean);
            break;
          case "time-pos": {
            const pos = data as number | null;
            if (pos !== null) {
              setTimePos(pos);
              timePosRef.current = pos;
              if (Math.floor(pos) > 0 && Math.floor(pos) % 5 === 0 && Math.floor(pos) !== progressSaveRef.current) {
                progressSaveRef.current = Math.floor(pos);
                invoke("update_watch_progress", {
                  episodeId: episodeIdRef.current,
                  progressSecs: Math.round(pos),
                }).catch(() => {});
              }
            }
            break;
          }
          case "duration": {
            const dur = data as number | null;
            if (dur !== null) {
              setDuration(dur);
              // Perform resume seek once duration is known (file fully loaded)
              if (resumeSecsRef.current > 0 && !resumeDoneRef.current) {
                resumeDoneRef.current = true;
                setProperty("time-pos", resumeSecsRef.current).catch(() => {});
              }
            }
            break;
          }
        }
      }).then((unlisten) => {
        unlistenRef.current = unlisten;
      });
    },
    [],
  );

  const loadFile = useCallback(async (filePath: string) => {
    await command("loadfile", [filePath]);
  }, []);

  const togglePlay = useCallback(async () => {
    try {
      await command("cycle", ["pause"]);
    } catch {
      /* mpv not ready */
    }
  }, []);

  const seek = useCallback(async (sec: number) => {
    try {
      await setProperty("time-pos", sec);
      setTimePos(sec);
    } catch {
      /* non-critical */
    }
  }, []);

  const setVol = useCallback(async (v: number) => {
    try {
      await setProperty("volume", v);
      setVolume(v);
    } catch {
      /* non-critical */
    }
  }, []);

  const refreshTracks = useCallback(async () => {
    try {
      const count = await getProperty("track-list/count", "int64");
      if (count == null || (count as number) === 0) {
        setTracks([]);
        return;
      }
      const n = count as number;
      const list: Track[] = [];
      for (let i = 0; i < n; i++) {
        const type = await getProperty(`track-list/${i}/type`, "string").catch(() => null);
        if (type !== "sub" && type !== "audio") continue;
        const id = await getProperty(`track-list/${i}/id`, "int64").catch(() => null);
        const title = await getProperty(`track-list/${i}/title`, "string").catch(() => null);
        const selected = await getProperty(`track-list/${i}/selected`, "flag").catch(() => null);
        list.push({
          id: (id as number) ?? i,
          type: type as "sub" | "audio",
          title: (title as string) || `${type === "sub" ? "字幕" : "音轨"} ${(id as number) ?? i}`,
          selected: !!selected,
        });
      }
      setTracks(list);
    } catch { /* mpv not ready */ }
  }, []);

  const setSubTrack = useCallback(async (trackId: number | null) => {
    try {
      // Use command instead of setProperty to avoid libmpv-wrapper type mismatch
      // (sid is mpv int64 but setProperty sends all numbers as double)
      await command("set", ["sid", trackId === null ? "no" : String(trackId)]);
      await refreshTracks();
    } catch { /* ignore */ }
  }, [refreshTracks]);

  const setAudioTrack = useCallback(async (trackId: number) => {
    try {
      await command("set", ["aid", String(trackId)]);
      await refreshTracks();
    } catch { /* ignore */ }
  }, [refreshTracks]);

  const cycleSpeed = useCallback(async () => {
    const next = speed >= 2.0 ? 1.0 : speed + 0.25;
    try {
      await setProperty("speed", next);
      setSpeed(next);
    } catch {
      /* non-critical */
    }
  }, [speed]);

  const setVideoMargins = useCallback(async (top: number, right: number, bottom: number, left: number) => {
    try {
      await setVideoMarginRatio({ top, right, bottom, left });
    } catch { /* non-critical */ }
  }, []);

  const loadSubtitleFiles = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      try {
        await command("sub-add", [path]);
      } catch { /* ignore */ }
    }
  }, []);

  const cycleSub = useCallback(async () => {
    try {
      await command("cycle", ["sid"]);
    } catch { /* ignore */ }
  }, []);

  const cleanup = useCallback(async () => {
    // Save progress but do NOT destroy the mpv context.
    // It stays alive for the lifetime of the app — destroying/recreating
    // races with the next init() in the native plugin layer.
    try {
      invoke("update_watch_progress", {
        episodeId: episodeIdRef.current,
        progressSecs: Math.round(timePosRef.current),
      }).catch(() => {});
      // Stop playback so audio/video don't leak after leaving the player page
      await command("stop", []).catch(() => {});
    } catch {
      /* non-critical */
    }
    // Unlisten observer to prevent stale callbacks after unmount
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    // Reset local state
    setTimePos(0);
    setDuration(0);
    setPaused(false);
    setTracks([]);
  }, []);

  return {
    timePos,
    duration,
    paused,
    volume,
    speed,
    tracks,
    initMpv,
    observe,
    loadFile,
    togglePlay,
    seek,
    setVol,
    cycleSpeed,
    setVideoMargins,
    loadSubtitleFiles,
    cycleSub,
    refreshTracks,
    setSubTrack,
    setAudioTrack,
    cleanup,
  };
}
