import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sectionTitle, label } from "../styles/settings";

type CloseBehavior = "tray" | "exit";

const BEHAVIOR_OPTIONS: { value: CloseBehavior; label: string }[] = [
  { value: "tray", label: "最小化到系统托盘" },
  { value: "exit", label: "彻底退出程序" },
];

export default function SettingsGeneral() {
  // ── close behavior ─────────────────────────────────────────────────────────
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>("tray");
  const [behaviorLoaded, setBehaviorLoaded] = useState(false);

  useEffect(() => {
    if (behaviorLoaded) return;
    setBehaviorLoaded(true);
    invoke<string>("get_close_behavior").then((v) => {
      if (v === "tray" || v === "exit") setCloseBehavior(v);
    }).catch(() => {});
  }, [behaviorLoaded]);

  const handleChangeBehavior = async (behavior: CloseBehavior) => {
    setCloseBehavior(behavior);
    try {
      await invoke("set_close_behavior", { behavior });
    } catch {
      /* revert on error */
    }
  };

  return (
    <>
      <h2 style={sectionTitle}>通用</h2>

      {/* ── Close Behavior ─────────────────────────────────────────── */}
      <label style={label}>关闭窗口行为</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {BEHAVIOR_OPTIONS.map((opt) => {
          const isActive = closeBehavior === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => handleChangeBehavior(opt.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 8,
                border: isActive ? "1px solid rgba(196,126,58,0.5)" : "1px solid var(--color-surface)",
                background: isActive ? "var(--color-accent-dim)" : "transparent",
                cursor: "pointer",
                textAlign: "left" as const,
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: isActive ? "5px solid var(--color-accent)" : "2px solid var(--color-text-muted)",
                  flexShrink: 0,
                  boxSizing: "border-box",
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                }}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── 语言（预留占位） ────────────────────────────────────────── */}
      <label style={label}>语言</label>
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 8,
          background: "var(--color-surface-elevated)",
        }}
      >
        <p style={placeholder}>简体中文（默认） — 多语言支持规划中</p>
      </div>
    </>
  );
}

// ── local styles ────────────────────────────────────────────────────────────────

const placeholder: React.CSSProperties = {
  fontSize: 13,
  color: "var(--color-text-muted)",
  margin: 0,
};
