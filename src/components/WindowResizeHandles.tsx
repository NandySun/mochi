import { useEffect, useRef, useCallback } from "react";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";

const HANDLE = 5;
const MIN_W = 800;
const MIN_H = 500;

type Edge =
  | "top" | "bottom" | "left" | "right"
  | "top-left" | "top-right" | "bottom-left" | "bottom-right";

const handles: { edge: Edge; cursor: string; style: React.CSSProperties }[] = [
  { edge: "top",           cursor: "ns-resize",  style: { top: 0, left: HANDLE, right: HANDLE, height: HANDLE } },
  { edge: "bottom",        cursor: "ns-resize",  style: { bottom: 0, left: HANDLE, right: HANDLE, height: HANDLE } },
  { edge: "left",          cursor: "ew-resize",  style: { left: 0, top: HANDLE, bottom: HANDLE, width: HANDLE } },
  { edge: "right",         cursor: "ew-resize",  style: { right: 0, top: HANDLE, bottom: HANDLE, width: HANDLE } },
  { edge: "top-left",      cursor: "nwse-resize",style: { top: 0, left: 0, width: HANDLE * 3, height: HANDLE * 3 } },
  { edge: "top-right",     cursor: "nesw-resize",style: { top: 0, right: 0, width: HANDLE * 3, height: HANDLE * 3 } },
  { edge: "bottom-left",   cursor: "nesw-resize",style: { bottom: 0, left: 0, width: HANDLE * 3, height: HANDLE * 3 } },
  { edge: "bottom-right",  cursor: "nwse-resize",style: { bottom: 0, right: 0, width: HANDLE * 3, height: HANDLE * 3 } },
];

export default function WindowResizeHandles({ disabled }: { disabled?: boolean }) {
  const dragging = useRef<Edge | null>(null);
  const start = useRef({ sx: 0, sy: 0, wx: 0, wy: 0, ww: 0, wh: 0 });
  const pendingRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const rafRef = useRef(0);
  // Synchronous cache avoids IPC delay on drag start
  const winW = useRef(window.innerWidth);
  const winH = useRef(window.innerHeight);
  const winX = useRef(0);
  const winY = useRef(0);

  useEffect(() => {
    const onResize = () => { winW.current = window.innerWidth; winH.current = window.innerHeight; };
    window.addEventListener("resize", onResize);
    getCurrentWindow().outerPosition().then(p => { winX.current = p.x; winY.current = p.y; }).catch(() => {});
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((edge: Edge, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = edge;
    start.current = {
      sx: e.screenX, sy: e.screenY,
      wx: winX.current, wy: winY.current,
      ww: winW.current, wh: winH.current,
    };
    // Refine position async (non-blocking)
    getCurrentWindow().outerPosition().then(p => {
      if (dragging.current) { start.current.wx = p.x; start.current.wy = p.y; }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const flush = async () => {
      const p = pendingRef.current;
      if (!p) return;
      pendingRef.current = null;
      try {
        const win = getCurrentWindow();
        const moved = p.x !== winX.current || p.y !== winY.current;
        const sized = p.w !== winW.current || p.h !== winH.current;
        const ops: Promise<void>[] = [];
        if (sized) ops.push(win.setSize(new LogicalSize(p.w, p.h)));
        if (moved) ops.push(win.setPosition(new PhysicalPosition(p.x, p.y)));
        if (ops.length) await Promise.all(ops);
        if (sized) { winW.current = p.w; winH.current = p.h; }
        if (moved) { winX.current = p.x; winY.current = p.y; }
      } catch { /* window may close mid-drag */ }
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const edge = dragging.current;
      const dx = e.screenX - start.current.sx;
      const dy = e.screenY - start.current.sy;

      let x = start.current.wx, y = start.current.wy;
      let w = start.current.ww, h = start.current.wh;

      if (edge.includes("right"))  w = start.current.ww + dx;
      if (edge.includes("left"))  { w = start.current.ww - dx; x = start.current.wx + dx; }
      if (edge.includes("bottom")) h = start.current.wh + dy;
      if (edge.includes("top"))   { h = start.current.wh - dy; y = start.current.wy + dy; }

      if (w < MIN_W) { if (edge.includes("left")) x = start.current.wx + start.current.ww - MIN_W; w = MIN_W; }
      if (h < MIN_H) { if (edge.includes("top")) y = start.current.wy + start.current.wh - MIN_H; h = MIN_H; }

      pendingRef.current = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; flush(); });
    };

    const onUp = () => { dragging.current = null; };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, []);

  if (disabled) return null;

  return (
    <>
      {handles.map(({ edge, cursor, style }) => (
        <div
          key={edge}
          style={{
            position: "fixed",
            zIndex: 9999,
            cursor,
            ...style,
          }}
          onPointerDown={(e) => { onPointerDown(edge, e); }}
        />
      ))}
    </>
  );
}
