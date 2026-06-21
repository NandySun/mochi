import { createContext, useContext, useState } from "react";
import type { ReactNode, Dispatch, SetStateAction } from "react";

export interface BgState {
  gradient: string;
  fanartPath: string | null;
  maskGradient: string;
}

const BackgroundContext = createContext<{
  bg: BgState;
  setBg: Dispatch<SetStateAction<BgState>>;
} | null>(null);

/* Semi-transparent gradients — this is the verified working approach for
 * making mpv video visible through the WebView.  The video renders to the
 * native window surface beneath the WebView; reduced CSS opacity lets it
 * show through while retaining fanart/gradient atmosphere. */
export const GRADIENTS = [
  "linear-gradient(160deg, rgba(26,42,58,0.4), rgba(42,64,88,0.4), rgba(61,90,120,0.4))",
  "linear-gradient(160deg, rgba(74,46,58,0.4), rgba(94,64,80,0.4), rgba(122,90,106,0.4))",
  "linear-gradient(160deg, rgba(138,80,32,0.4), rgba(176,104,48,0.4), rgba(196,126,58,0.4))",
  "linear-gradient(160deg, rgba(58,80,64,0.4), rgba(74,107,94,0.4), rgba(90,138,110,0.4))",
  "linear-gradient(160deg, rgba(90,58,42,0.4), rgba(139,94,74,0.4), rgba(160,112,80,0.4))",
  "linear-gradient(160deg, rgba(58,42,90,0.4), rgba(90,74,107,0.4), rgba(122,106,139,0.4))",
];

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [bg, setBg] = useState<BgState>({
    gradient: GRADIENTS[0],
    fanartPath: null,
    maskGradient: "linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.6) 100%)",
  });

  return (
    <BackgroundContext.Provider value={{ bg, setBg }}>
      {children}
    </BackgroundContext.Provider>
  );
}

export function useBackground() {
  const ctx = useContext(BackgroundContext);
  if (!ctx) throw new Error("useBackground must be used within BackgroundProvider");
  return ctx;
}
