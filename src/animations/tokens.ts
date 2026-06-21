import type { Target } from "framer-motion";

// ── Spring presets ─────────────────────────────────────────────────────

export const spring = {
  /** Daily interactions: fast but elastic */
  gentle: { type: "spring" as const, stiffness: 300, damping: 25 },
  /** Button press: faster rebound */
  press: { type: "spring" as const, stiffness: 500, damping: 30 },
  /** Page transitions: slow, soft, with inertia */
  page: { type: "spring" as const, stiffness: 200, damping: 28 },
  /** Back-navigation: ~20% faster than page */
  back: { type: "spring" as const, stiffness: 240, damping: 26 },
  /** Background gradient: very slow */
  bg: { type: "spring" as const, stiffness: 100, damping: 50 },
  /** Poster zoom: subtle overshoot */
  poster: { type: "spring" as const, stiffness: 350, damping: 22 },
  /** Settings card slide: snappy overshoot */
  settings: { type: "spring" as const, stiffness: 400, damping: 30 },
} as const;

export const durations = {
  hover: 0.15,
  fade: 0.3,
  bg: 1.2,
} as const;

// ── Page animation configs ─────────────────────────────────────────────
// Used by PageWrapper to pick per-direction enter/exit variants.

export interface PageAnimConfig {
  /** Forward-navigation initial state */
  enterFwd: Target;
  /** Back-navigation initial state */
  enterBwd: Target;
  /** Forward-navigation exit state */
  exitFwd: Target;
  /** Back-navigation exit state */
  exitBwd: Target;
}

/**
 * Per-page animation presets.
 *
 * Design rationale:
 * - Forward navigation: "diving deeper" — new page slides in, old page
 *   recedes. PosterWall shrinks back; SeriesDetail slides from right;
 *   VideoPlayer pops up from bottom.
 * - Backward navigation: reverse direction + ~20% faster spring.
 *   Old page slides out opposite direction, new page slides back in.
 */
export const pageAnimations: Record<string, PageAnimConfig> = {
  posterWall: {
    enterFwd: { opacity: 0, y: 12 },
    enterBwd: { opacity: 0, y: -6 },
    // Always: shrink + fade when leaving ("sink down a layer")
    exitFwd: { opacity: 0, scale: 0.97 },
    exitBwd: { opacity: 0, scale: 0.97 },
  },
  seriesDetail: {
    // opacity-only: avoid x/y transforms that would shift
    // position:fixed children (back button) during transition.
    enterFwd: { opacity: 0 },
    enterBwd: { opacity: 0 },
    exitFwd: { opacity: 0 },
    exitBwd: { opacity: 0 },
  },
  videoPlayer: {
    // opacity-only: no x/y/scale to avoid compositing layers
    // that block the native mpv surface in transparent window mode.
    enterFwd: { opacity: 0 },
    enterBwd: { opacity: 0 },
    exitFwd: { opacity: 0 },
    exitBwd: { opacity: 0 },
  },
} as const satisfies Record<string, PageAnimConfig>;
