import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { spring } from "../animations/tokens";

import SettingsMedia from "./SettingsMedia";
import SettingsMetadata from "./SettingsMetadata";
import SettingsPlayback from "./SettingsPlayback";
import SettingsGeneral from "./SettingsGeneral";
import SettingsAbout from "./SettingsAbout";

// ── Section definitions ──────────────────────────────────────────────────────

type SectionId = "media" | "metadata" | "playback" | "general" | "about";

interface SectionDef {
  id: SectionId;
  label: string;
  component: React.ComponentType;
}

const SECTIONS: SectionDef[] = [
  { id: "media",    label: "媒体库", component: SettingsMedia },
  { id: "metadata", label: "元数据", component: SettingsMetadata },
  { id: "playback", label: "播放",   component: SettingsPlayback },
  { id: "general",  label: "通用",   component: SettingsGeneral },
  { id: "about",    label: "关于",   component: SettingsAbout },
];

export default function Settings({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<SectionId>("media");

  // ── ESC key close ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const ActiveComponent = SECTIONS.find((s) => s.id === active)?.component ?? SettingsMedia;

  return createPortal(
    <>
      {/* Overlay */}
      <motion.div
        key="settings-overlay"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.6)",
        }}
      />
      {/* Card — wrapper handles centering, motion.div handles slide */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 101,
      }}>
        <motion.div
          key="settings-card"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={spring.settings}
          style={{
            width: 720, maxHeight: "80vh",
            background: "rgba(14,14,14,0.95)", backdropFilter: "blur(16px)",
            borderRadius: 14, overflow: "hidden",
            display: "flex",
          }}
        >
        {/* Close button */}
        <button onClick={onClose} style={{
          position: "absolute", top: 16, right: 16, zIndex: 102,
          width: 28, height: 28, borderRadius: "50%",
          background: "rgba(255,255,255,0.08)", border: "none",
          cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 14,
        }}>✕</button>

        {/* ── Sidebar ──────────────────────────────────────────────── */}
        <nav style={{
          width: 140,
          flexShrink: 0,
          padding: "48px 0 24px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}>
          {SECTIONS.map((sec) => {
            const isActive = active === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => setActive(sec.id)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  padding: "9px 14px 9px 16px",
                  border: "none",
                  borderRadius: 0,
                  background: isActive ? "rgba(255,255,255,0.04)" : "transparent",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? "#c47e3a" : "rgba(255,255,255,0.4)",
                  textAlign: "left" as const,
                  width: "100%",
                }}
              >
                {/* accent bar */}
                {isActive && (
                  <motion.div
                    layoutId="settings-sidebar-accent"
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 6,
                      bottom: 6,
                      width: 3,
                      borderRadius: 2,
                      background: "#c47e3a",
                    }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                {sec.label}
              </button>
            );
          })}
        </nav>

        {/* ── Content area ─────────────────────────────────────────── */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          maxHeight: "80vh",
          padding: "48px 36px 36px",
        }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: "easeInOut" }}
            >
              <ActiveComponent />
            </motion.div>
          </AnimatePresence>
        </div>
        </motion.div>
      </div>
    </>,
    document.body
  );
}
