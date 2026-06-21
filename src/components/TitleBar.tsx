import { invoke } from "@tauri-apps/api/core";

export default function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      style={{
        height: 40,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        background: "transparent",
        borderBottom: "none",
        position: "relative",
        zIndex: 2,
      }}
    >
      {/* Left: app name */}
      <span
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.35)",
          letterSpacing: 2,
          fontWeight: 500,
        }}
      >
        Mochi
      </span>

      {/* Right: window controls (no drag region so buttons are clickable) */}
      <div style={{ display: "flex", gap: 4 }}>
        <WinBtn symbol="─" onClick={() => invoke("window_minimize")} />
        <WinBtn symbol="□" onClick={() => invoke("window_toggle_maximize")} />
        <WinBtn symbol="✕" onClick={() => invoke("window_close")} isClose />
      </div>
    </header>
  );
}

function WinBtn({
  symbol,
  onClick,
  isClose = false,
}: {
  symbol: string;
  onClick: () => void;
  isClose?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        fontSize: 12,
        color: "rgba(255,255,255,0.3)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        if (isClose) {
          e.currentTarget.style.background = "#e81123";
          e.currentTarget.style.color = "#fff";
        } else {
          e.currentTarget.style.background = "rgba(255,255,255,0.08)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(255,255,255,0.3)";
      }}
    >
      {symbol}
    </button>
  );
}
