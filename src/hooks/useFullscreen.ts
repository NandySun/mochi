import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Read initial fullscreen state from native window on mount
  useEffect(() => {
    invoke<boolean>("get_fullscreen").then(setIsFullscreen).catch(() => {});
  }, []);

  const toggle = useCallback(async () => {
    const next = !isFullscreen;
    // Update React state FIRST so the overlay renders immediately.
    // Then call the native API. Revert on failure.
    setIsFullscreen(next);
    try {
      await invoke("set_fullscreen", { fullscreen: next });
    } catch (e) {
      console.error("Fullscreen toggle failed:", e);
      setIsFullscreen(!next);
    }
  }, [isFullscreen]);

  return { isFullscreen, toggle };
}
