import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

type Direction = 1 | -1;
const NavDirectionContext = createContext<Direction>(1);

/**
 * Tracks navigation direction by maintaining a pathname history stack.
 * Forward (1): entering a new page deeper in the hierarchy
 * Backward (-1): returning to a previously visited page
 *
 * Derived synchronously during render (via ref mutation) so direction is
 * available on the same render that sees the new pathname.
 */
export function NavDirectionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const historyRef = useRef<string[]>([]);
  const directionRef = useRef<Direction>(1);

  // Seed history on first render
  if (historyRef.current.length === 0) {
    historyRef.current = [pathname];
  }

  const history = historyRef.current;
  const last = history[history.length - 1];

  if (pathname !== last) {
    const backIdx = history.lastIndexOf(pathname);
    if (backIdx >= 0) {
      // Going back to a known page
      directionRef.current = -1;
      history.splice(backIdx + 1); // trim forward entries
    } else {
      // Forward to a new page
      directionRef.current = 1;
      history.push(pathname);
    }
  }

  return (
    <NavDirectionContext.Provider value={directionRef.current}>
      {children}
    </NavDirectionContext.Provider>
  );
}

export function useNavDirection(): Direction {
  return useContext(NavDirectionContext);
}
