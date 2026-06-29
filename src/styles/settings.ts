/** Shared CSS-in-JS constants for Settings sub-components. */

import type { CSSProperties } from "react";

export const sectionTitle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 2,
  marginBottom: 16,
};

export const actionBtn: CSSProperties = {
  background: "var(--color-surface)",
  color: "var(--color-text-secondary)",
  borderRadius: 8,
  padding: "6px 20px",
  fontSize: 12,
  border: "none",
  cursor: "pointer",
};

export const label: CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "var(--color-text-secondary)",
  marginBottom: 6,
};

export const kbdStyle: CSSProperties = {
  display: "inline-block",
  minWidth: 36,
  textAlign: "center",
  padding: "3px 10px",
  borderRadius: 5,
  background: "var(--color-kbd-bg)",
  border: "1px solid var(--color-kbd-border)",
  color: "var(--color-kbd-text)",
  fontSize: 11,
  fontFamily: "inherit",
  lineHeight: 1.4,
  whiteSpace: "nowrap" as const,
};
