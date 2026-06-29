import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sectionTitle, actionBtn, label } from "../styles/settings";

const GITHUB_URL = "https://github.com/NandySun/mochi";

export default function SettingsAbout() {
  const [version, setVersion] = useState<string>("…");

  useEffect(() => {
    invoke<string>("get_app_version")
      .then(setVersion)
      .catch(() => setVersion("unknown"));
  }, []);

  return (
    <>
      <h2 style={sectionTitle}>关于</h2>

      {/* ── App name + version ──────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
          Mochi <span style={{ fontSize: 14, fontWeight: 400, color: "var(--color-text-muted)" }}>v{version}</span>
        </p>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
          桌面原生个人多媒体库
        </p>
      </div>

      {/* ── Tech stack ──────────────────────────────────────────────── */}
      <label style={label}>技术栈</label>
      <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 20px", lineHeight: 1.8 }}>
        Tauri v2 · React 19 · libmpv · SQLite · Bangumi · TMDB
      </p>

      {/* ── GitHub ──────────────────────────────────────────────────── */}
      <label style={label}>仓库</label>
      <div style={{ marginBottom: 20 }}>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, color: "var(--color-accent)", textDecoration: "none" }}
        >
          {GITHUB_URL}
        </a>
      </div>

      {/* ── Check for updates ──────────────────────────────────────── */}
      <button
        style={actionBtn}
        onClick={() => window.open(`${GITHUB_URL}/releases`, "_blank")}
      >
        检查更新
      </button>

      {/* ── Credits ─────────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid var(--color-surface-elevated)", paddingTop: 20, marginTop: 24 }}>
        <label style={label}>致谢</label>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 12px", lineHeight: 1.7 }}>
          mpv · Tauri · Bangumi · TMDB
        </p>
      </div>

      {/* ── Copyright ───────────────────────────────────────────────── */}
      <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 8px" }}>
        © 2025-2026 Revm
      </p>

      {/* ── License ─────────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid var(--color-surface-elevated)", paddingTop: 16, marginTop: 12 }}>
        <label style={label}>许可证</label>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 6px" }}>
          Mochi 采用 MIT 许可证发布。
        </p>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0, lineHeight: 1.6 }}>
          内置 libmpv 为 LGPLv2.1+ 许可，详见 mpv 官方文档。
        </p>
      </div>
    </>
  );
}


