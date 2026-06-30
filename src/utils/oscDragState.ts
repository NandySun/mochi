// ── OSC drag state ────────────────────────────────────────────────────
// Tracks whether the current mousedown originated inside the OSC.
//
// Why this exists: when a user starts a drag inside the OSC (e.g. dragging
// the volume knob or the timeline knob) and releases the mouse outside
// the OSC, the browser synthesises a click event on the *common ancestor*
// of the mousedown and mouseup elements. That ancestor is the video area
// itself, so without this guard, the video area's onClick would fire
// `togglePlay` and pause the video mid-drag.
//
// The flag is set when a mousedown fires inside the OSC root (captured
// in the capture phase so internal `stopPropagation` calls don't
// shadow it) and cleared on the next `mouseup` (which always reaches
// `window` even if it happens off the OSC).

let oscMouseDown = false;

export function setOscMouseDown(v: boolean): void {
  oscMouseDown = v;
}

export function consumeOscMouseDown(): boolean {
  if (oscMouseDown) {
    oscMouseDown = false;
    return true;
  }
  return false;
}
