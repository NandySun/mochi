import { useState, useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, LayoutGroup, motion, useMotionValue, useSpring } from "framer-motion";
import { NavDirectionProvider } from "./hooks/useNavigationDirection";
import { BackgroundProvider, useBackground } from "./hooks/useBackground";
import { useImageSrc } from "./hooks/useImageSrc";
import { pageAnimations } from "./animations/tokens";
import TitleBar from "./components/TitleBar";
import PageWrapper from "./components/PageWrapper";
import PosterWall from "./components/PosterWall";
import SeriesDetail from "./components/SeriesDetail";
import VideoPlayer from "./components/VideoPlayer";
import Settings from "./components/Settings";
import WindowResizeHandles from "./components/WindowResizeHandles";

function GlobalBackground() {
  const { bg, gradientVersion, tempDirection } = useBackground();
  const fanartSrc = useImageSrc(bg.fanartPath);

  // ── Asymmetric crossfade timing (基于温度方向) ────────────────────
  // 冷→暖 (tempDirection=1): 冷色缓慢消退 0.9s，暖色快速渗入 0.6s
  // 暖→冷 (tempDirection=-1): 暖色快速消退 0.45s，冷色缓慢渗入 1.05s
  // 同温 (0): 对称 crossfade 各 0.75s

  const exitDuration = tempDirection === -1 ? 0.45 : tempDirection === 1 ? 0.9 : 0.75;
  const enterDelay = tempDirection === -1 ? 0.45 : tempDirection === 1 ? 0.9 : 0;
  const enterDuration = tempDirection === -1 ? 1.05 : tempDirection === 1 ? 0.6 : 1.5;

  // ── Parallax: subtle mouse-follow on fanart layer ─────────────────
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const parallaxX = useSpring(mouseX, { stiffness: 50, damping: 30 });
  const parallaxY = useSpring(mouseY, { stiffness: 50, damping: 30 });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      mouseX.set((e.clientX / window.innerWidth - 0.5) * 12);
      mouseY.set((e.clientY / window.innerHeight - 0.5) * 12);
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [mouseX, mouseY]);

  return (
    <>
      {/* Gradient layer: 温度感知不对称 crossfade */}
      <AnimatePresence>
        <motion.div
          key={gradientVersion}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: exitDuration, ease: "easeInOut" } }}
          transition={{
            duration: enterDuration,
            delay: enterDelay,
            ease: "easeInOut",
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 0,
            background: bg.gradient,
            pointerEvents: "none",
          }}
        />
      </AnimatePresence>

      {fanartSrc && (
        <motion.div
          style={{
            position: "fixed",
            inset: "-4%",
            zIndex: 0,
            backgroundImage: `url(${fanartSrc})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: 0.35,
            pointerEvents: "none",
            x: parallaxX,
            y: parallaxY,
          }}
        />
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
  const location = useLocation();
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
    <NavDirectionProvider>
      <BackgroundProvider>
        <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          {!isFullscreen && <TitleBar />}
          <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
            <GlobalBackground />
            <main style={{ flex: 1, position: "relative", zIndex: 1, overflow: "hidden" }}>
              <LayoutGroup>
                <AnimatePresence mode="wait">
                  <Routes location={location} key={location.pathname}>
                  <Route
                    path="/"
                    element={
                      <PageWrapper config={pageAnimations.posterWall}>
                        <PosterWall onOpenSettings={() => setShowSettings(true)} />
                      </PageWrapper>
                    }
                  />
                  <Route
                    path="/series/:id"
                    element={
                      <PageWrapper config={pageAnimations.seriesDetail}>
                        <SeriesDetail />
                      </PageWrapper>
                    }
                  />
                  <Route
                    path="/play/:episodeId"
                    element={
                      <PageWrapper config={pageAnimations.videoPlayer}>
                        <VideoPlayer onFullscreenChange={setIsFullscreen} />
                      </PageWrapper>
                    }
                  />
                </Routes>
              </AnimatePresence>
                </LayoutGroup>

              {/* Settings portal — separate AnimatePresence for overlay + card */}
              <AnimatePresence>
                {showSettings && <Settings onClose={() => setShowSettings(false)} />}
              </AnimatePresence>
            </main>
            <WindowResizeHandles disabled={isFullscreen} />
          </div>
        </div>
      </BackgroundProvider>
    </NavDirectionProvider>
  );
}
