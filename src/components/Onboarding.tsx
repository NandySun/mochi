import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { spring } from "../animations/tokens";
import { BreathingDot } from "./BreathingDot";

interface OnboardingProps {
  onComplete: () => void;
  onOpenSettings: () => void;
}

export default function Onboarding({ onComplete, onOpenSettings }: OnboardingProps) {
  const finish = () => {
    localStorage.setItem("mochi_onboarding_complete", "1");
    onComplete();
  };

  const handleCreateStructure = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: "选择媒体库位置" });
      if (typeof selected !== "string" || !selected) return;

      await invoke("create_library_structure", { basePath: selected });
      localStorage.setItem(
        "mochi_root_dirs",
        JSON.stringify([{ path: selected, type: "auto" }])
      );
      finish();
      // Trigger scan after onboarding closes
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    } catch {
      // dialog plugin unavailable or create failed — go to settings
      finish();
      onOpenSettings();
    }
  };

  const handleSelectExisting = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: "选择已有媒体文件夹" });
      if (typeof selected !== "string" || !selected) return;

      localStorage.setItem(
        "mochi_root_dirs",
        JSON.stringify([{ path: selected, type: "auto" }])
      );
      finish();
      // Trigger scan after onboarding closes
      window.dispatchEvent(new CustomEvent("mochi:data-changed"));
    } catch {
      finish();
      onOpenSettings();
    }
  };

  const handleGoToSettings = () => {
    finish();
    onOpenSettings();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-overlay)",
        backdropFilter: "blur(16px)",
        userSelect: "none",
        gap: 16,
      }}
    >
      {/* Background: mochi breathing dot */}
      <BreathingDot size={24} />

      {/* Welcome text */}
      <motion.h1
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.gentle, delay: 0.2 }}
        style={{
          fontSize: 24,
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          margin: 0,
        }}
      >
        欢迎使用 Mochi
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.gentle, delay: 0.35 }}
        style={{
          fontSize: 13,
          color: "var(--color-text-muted)",
          margin: 0,
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        Mochi 按四种类型管理你的本地媒体：
        <br />
        动漫 · 电影 · 影视剧 · 综艺
      </motion.p>

      {/* Card: create recommended structure */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.gentle, delay: 0.5 }}
        whileHover={{ backgroundColor: "var(--color-accent-dim)" }}
        whileTap={{ scale: 0.98 }}
        onClick={handleCreateStructure}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          padding: "16px 28px",
          borderRadius: 12,
          border: "1px solid var(--color-accent-dim)",
          background: "var(--color-modal-bg)",
          cursor: "pointer",
          maxWidth: 360,
          width: "80%",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
          创建推荐文件夹结构
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          将创建 anime/ movie/ tv/ variety/ 四个子文件夹
        </span>
      </motion.button>

      {/* Card: select existing folder */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.gentle, delay: 0.57 }}
        whileHover={{ backgroundColor: "var(--color-surface-elevated)" }}
        whileTap={{ scale: 0.98 }}
        onClick={handleSelectExisting}
        style={{
          padding: "14px 28px",
          borderRadius: 12,
          border: "1px solid rgba(196,180,140,0.12)",
          background: "var(--color-modal-bg)",
          cursor: "pointer",
          fontSize: 14,
          color: "var(--color-text-secondary)",
          maxWidth: 360,
          width: "80%",
        }}
      >
        选择已有文件夹
      </motion.button>

      {/* Card: go to settings */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.gentle, delay: 0.64 }}
        whileHover={{ backgroundColor: "var(--color-surface-elevated)" }}
        whileTap={{ scale: 0.98 }}
        onClick={handleGoToSettings}
        style={{
          padding: "14px 28px",
          borderRadius: 12,
          border: "1px solid var(--color-surface-elevated)",
          background: "var(--color-modal-bg)",
          cursor: "pointer",
          fontSize: 14,
          color: "var(--color-text-secondary)",
          maxWidth: 360,
          width: "80%",
        }}
      >
        我已有文件夹，直接设置
      </motion.button>

      {/* Footer hint */}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...spring.gentle, delay: 0.8 }}
        style={{ fontSize: 11, color: "var(--color-surface-hover)", cursor: "pointer" }}
        onClick={handleGoToSettings}
      >
        或按 Ctrl+, 稍后设置
      </motion.span>
    </motion.div>
  );
}
