import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const cache = new Map<string, string>();

export function useImageSrc(path: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() => {
    if (!path) return null;
    return cache.get(path) ?? null;
  });

  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }
    if (cache.has(path)) {
      setSrc(cache.get(path)!);
      return;
    }
    let cancelled = false;
    invoke<string>("read_image_base64", { path })
      .then((dataUrl) => {
        if (cancelled) return;
        cache.set(path, dataUrl);
        setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return src;
}
