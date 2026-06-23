import { useState, useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, LayoutGroup, motion, useMotionValue, useSpring } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
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
import Onboarding from "./components/Onboarding";
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
  const [showTrayTip, setShowTrayTip] = useState(false);
  const [showBatchDone, setShowBatchDone] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── First-launch onboarding ───────────────────────────────────────
  useEffect(() => {
    if (localStorage.getItem("mochi_onboarding_complete") !== "1") {
      setShowOnboarding(true);
    }
  }, []);

  // ── First-time tray minimize toast ────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("tray-minimized", () => {
      if (localStorage.getItem("mochi_tray_tip_shown") === "1") return;
      localStorage.setItem("mochi_tray_tip_shown", "1");
      setShowTrayTip(true);
      setTimeout(() => setShowTrayTip(false), 3000);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // ── Batch metadata fetch completion banner ────────────────────────
  useEffect(() => {
    const onComplete = () => {
      setShowBatchDone(true);
      setTimeout(() => setShowBatchDone(false), 4000);
    };
    window.addEventListener("mochi:batch-fetch-complete", onComplete);
    return () => window.removeEventListener("mochi:batch-fetch-complete", onComplete);
  }, []);

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
              {/* ── First-launch onboarding overlay ────────────────── */}
              <AnimatePresence>
                {showOnboarding && (
                  <Onboarding
                    onComplete={() => setShowOnboarding(false)}
                    onOpenSettings={() => {
                      setShowSettings(true);
                      setShowOnboarding(false);
                    }}
                  />
                )}
              </AnimatePresence>

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

          {/* ── Tray minimize toast ──────────────────────────────────── */}
          <AnimatePresence>
            {showTrayTip && (
              <motion.div
                key="tray-tip"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ type: "spring", stiffness: 400, damping: 28 }}
                style={{
                  position: "fixed",
                  bottom: 24,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 10000,
                  padding: "10px 22px",
                  borderRadius: 10,
                  background: "rgba(40,32,18,0.88)",
                  backdropFilter: "blur(10px)",
                  border: "1px solid rgba(196,126,58,0.2)",
                  color: "rgba(255,230,190,0.85)",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                }}
              >
                Mochi 已最小化到系统托盘，右键图标可退出
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Batch metadata fetch done banner ──────────────────── */}
          <AnimatePresence>
            {showBatchDone && (
              <motion.div
                key="batch-done"
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ type: "spring", stiffness: 400, damping: 28 }}
                style={{
                  position: "fixed",
                  top: 44,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 10000,
                  padding: "8px 20px",
                  borderRadius: 10,
                  background: "rgba(30,40,24,0.88)",
                  backdropFilter: "blur(10px)",
                  border: "1px solid rgba(126,196,58,0.2)",
                  color: "rgba(190,255,180,0.85)",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                }}
              >
                元数据拉取完成 ✓
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </BackgroundProvider>
    </NavDirectionProvider>
  );
}
