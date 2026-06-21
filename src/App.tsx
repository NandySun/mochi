import { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { BackgroundProvider, useBackground } from "./hooks/useBackground";
import { useImageSrc } from "./hooks/useImageSrc";
import TitleBar from "./components/TitleBar";
import PosterWall from "./components/PosterWall";
import SeriesDetail from "./components/SeriesDetail";
import VideoPlayer from "./components/VideoPlayer";
import Settings from "./components/Settings";

function GlobalBackground() {
  const { bg } = useBackground();
  const fanartSrc = useImageSrc(bg.fanartPath);

  return (
    <>
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        background: bg.gradient,
        transition: "background 0.5s ease",
        pointerEvents: "none",
      }} />
      {fanartSrc && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 0,
          backgroundImage: `url(${fanartSrc})`,
          backgroundSize: "cover", backgroundPosition: "center",
          opacity: 0.35,
          pointerEvents: "none",
        }} />
      )}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        pointerEvents: "none",
        background: bg.maskGradient,
        transition: "background 0.5s ease",
      }} />
    </>
  );
}

export default function App() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // ── Global keyboard shortcuts ───────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <BackgroundProvider>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        {!isFullscreen && <TitleBar />}
        <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
          <GlobalBackground />
          <main style={{ flex: 1, position: "relative", zIndex: 1, overflow: "hidden" }}>
            <Routes>
              <Route path="/" element={<PosterWall onOpenSettings={() => setShowSettings(true)} />} />
              <Route path="/series/:id" element={<SeriesDetail />} />
              <Route path="/play/:episodeId" element={<VideoPlayer onFullscreenChange={setIsFullscreen} />} />
            </Routes>
            {showSettings && <Settings onClose={() => setShowSettings(false)} />}
          </main>
        </div>
      </div>
    </BackgroundProvider>
  );
}
