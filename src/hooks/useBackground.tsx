import { createContext, useContext, useState, useRef, useCallback } from "react";
import type { ReactNode, Dispatch, SetStateAction } from "react";
import { getTransitionDirection, type TempDirection } from "../utils/color";

export interface BgState {
  gradient: string;
  fanartPath: string | null;
  maskGradient: string;
}

interface BgContextValue {
  bg: BgState;
  setBg: Dispatch<SetStateAction<BgState>>;
  /** 渐变版本号，每次 gradient 变化时递增，驱动 AnimatePresence */
  gradientVersion: number;
  /** 温度变化方向：1=变暖，-1=变冷，0=同温/初始 */
  tempDirection: TempDirection;
}

const BackgroundContext = createContext<BgContextValue | null>(null);

/* Semi-transparent gradients — this is the verified working approach for
 * making mpv video visible through the WebView.  The video renders to the
 * native window surface beneath the WebView; reduced CSS opacity lets it
 * show through while retaining fanart/gradient atmosphere.
 *
 * 6 组莫兰迪渐变，色相保持冷暖覆盖，透明度从 0.4 → 0.45 适配新暖灰底。
 */
export const GRADIENTS = [
  "linear-gradient(160deg, rgba(26,42,58,0.45), rgba(42,64,88,0.45), rgba(61,90,120,0.45))",
  "linear-gradient(160deg, rgba(74,46,58,0.45), rgba(94,64,80,0.45), rgba(122,90,106,0.45))",
  "linear-gradient(160deg, rgba(138,80,32,0.45), rgba(176,104,48,0.45), rgba(196,126,58,0.45))",
  "linear-gradient(160deg, rgba(58,80,64,0.45), rgba(74,107,94,0.45), rgba(90,138,110,0.45))",
  "linear-gradient(160deg, rgba(90,58,42,0.45), rgba(139,94,74,0.45), rgba(160,112,80,0.45))",
  "linear-gradient(160deg, rgba(58,42,90,0.45), rgba(90,74,107,0.45), rgba(122,106,139,0.45))",
];

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [bg, setBg] = useState<BgState>({
    gradient: GRADIENTS[0],
    fanartPath: null,
    maskGradient: "linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.36) 60%, rgba(0,0,0,0.54) 100%)",
  });

  const [gradientVersion, setGradientVersion] = useState(0);
  const [tempDirection, setTempDirection] = useState<TempDirection>(0);
  const prevGradient = useRef(bg.gradient);

  // 包裹 setBg，在 gradient 变化时更新版本号和温度方向
  const setBgWithTemp: Dispatch<SetStateAction<BgState>> = useCallback((value) => {
    setBg((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      if (next.gradient !== prev.gradient) {
        const dir = getTransitionDirection(prevGradient.current, next.gradient);
        prevGradient.current = next.gradient;
        setTempDirection(dir);
        setGradientVersion((v) => v + 1);
      }
      return next;
    });
  }, []);

  return (
    <BackgroundContext.Provider value={{ bg, setBg: setBgWithTemp, gradientVersion, tempDirection }}>
      {children}
    </BackgroundContext.Provider>
  );
}

export function useBackground() {
  const ctx = useContext(BackgroundContext);
  if (!ctx) throw new Error("useBackground must be used within BackgroundProvider");
  return ctx;
}
