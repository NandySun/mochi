/** Shared CSS-in-JS constants for Settings sub-components. */

import type { CSSProperties } from "react";

export const sectionTitle: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.3)",
  textTransform: "uppercase",
  letterSpacing: 2,
  marginBottom: 16,
};

export const actionBtn: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.6)",
  borderRadius: 8,
  padding: "6px 20px",
  fontSize: 12,
  border: "none",
  cursor: "pointer",
};

export const label: CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "rgba(255,255,255,0.45)",
  marginBottom: 6,
};
