type IconProps = { size?: number; className?: string };

const baseProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

/** ⏮ — two left-pointing chevrons */
export function IconPrev({ size = 14, className }: IconProps) {
  const p = baseProps(size);
  return (
    <svg {...p} className={className}>
      <polyline points="15,6 7,12 15,18" />
      <polyline points="21,6 13,12 21,18" />
    </svg>
  );
}

/** ▶ — right-pointing triangle (filled for visual weight) */
export function IconPlay({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
    >
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  );
}

/** ⏸ — two vertical bars */
export function IconPause({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
    >
      <rect x="5" y="4" width="5" height="16" rx="1" />
      <rect x="14" y="4" width="5" height="16" rx="1" />
    </svg>
  );
}

/** ⏭ — two right-pointing chevrons */
export function IconNext({ size = 14, className }: IconProps) {
  const p = baseProps(size);
  return (
    <svg {...p} className={className}>
      <polyline points="9,6 17,12 9,18" />
      <polyline points="3,6 11,12 3,18" />
    </svg>
  );
}

/** 🔊 — speaker with arcs */
export function IconVolume({ size = 14, className }: IconProps) {
  const p = baseProps(size);
  return (
    <svg {...p} className={className}>
      <polygon points="3,9 7,9 12,5 12,19 7,15 3,15" />
      <path d="M15.5 8.5a5 5 0 010 7" />
      <path d="M18.5 5.5a9 9 0 010 13" />
    </svg>
  );
}

/** 🔇 — muted speaker with X */
export function IconVolumeMute({ size = 14, className }: IconProps) {
  const p = baseProps(size);
  return (
    <svg {...p} className={className}>
      <polygon points="3,9 7,9 12,5 12,19 7,15 3,15" />
      <line x1="16" y1="8" x2="22" y2="14" />
      <line x1="22" y1="8" x2="16" y2="14" />
    </svg>
  );
}

/** 📋 — four rounded rectangles in a grid */
export function IconEpisodes({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}
