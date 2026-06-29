import { motion } from "framer-motion";

export default function DropOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-overlay)",
        backdropFilter: "blur(2px)",
        pointerEvents: "none",
      }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={{
          padding: "32px 48px",
          borderRadius: 12,
          border: "2px dashed var(--color-accent-dim)",
          background: "var(--color-modal-bg)",
          userSelect: "none",
        }}
      >
        <span
          style={{
            fontSize: 14,
            color: "var(--color-text-muted)",
          }}
        >
          拖放文件夹到此处添加至 Mochi
        </span>
      </motion.div>
    </motion.div>
  );
}
