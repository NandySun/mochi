import { useEffect, useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { spring } from "../animations/tokens";

// ── SynopsisPopover ─────────────────────────────────────────────────────

interface SynopsisPopoverProps {
  synopsis: string | null;
  genres: string[];
  year: number | null;
  episodeCount: number;
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

export default function SynopsisPopover({
  synopsis,
  genres,
  year,
  episodeCount,
  isOpen,
  onClose,
  triggerRef,
}: SynopsisPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 0 });

  // Calculate position relative to trigger
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, [isOpen, triggerRef]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Close on outside click
  const handleMaskClick = useCallback(
    (e: React.MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    },
    [onClose]
  );

  if (!synopsis) return null;

  const tagPills = [
    ...genres,
    ...(year ? [`${year} · ${episodeCount}集`] : []),
  ];

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop mask */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleMaskClick}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 90,
              background: "var(--color-overlay)",
            }}
          />

          {/* Popover */}
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring.gentle}
            style={{
              position: "fixed",
              top: position.top,
              right: position.right,
              zIndex: 100,
              width: 380,
              maxHeight: 260,
              background: "#1c1916",
              border: "1px solid var(--color-surface)",
              borderRadius: 10,
              boxShadow: "0 16px 48px var(--color-overlay)",
              overflowY: "auto",
              scrollbarWidth: "none",
              padding: 16,
            }}
          >
            <style>{`.synopsis-popover::-webkit-scrollbar { display: none; }`}</style>

            {/* Synopsis text */}
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 13.5,
                lineHeight: 1.7,
                color: "var(--color-text-secondary)",
              }}
            >
              {synopsis}
            </p>

            {/* Tag pills */}
            {tagPills.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tagPills.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      border: "1px solid var(--color-surface-elevated)",
                      borderRadius: 10,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
