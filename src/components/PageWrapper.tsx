import { useRef } from "react";
import { motion } from "framer-motion";
import { spring, type PageAnimConfig } from "../animations/tokens";
import { useNavDirection } from "../hooks/useNavigationDirection";

type PageWrapperProps = {
  children: React.ReactNode;
  /** Page animation preset — defines enter/exit variants per direction */
  config: PageAnimConfig;
};

/**
 * Unified page transition container with direction-aware animation.
 *
 * Uses `useNavDirection()` to pick forward vs. backward variants.
 * Backward animations use `spring.back` (~20% faster) by default
 * so "going back" feels snappier than "going in".
 *
 * After enter animation completes, identity transforms (translateX(0), etc.)
 * are removed from the DOM.  Without this, even a zero-value transform creates
 * a new CSS containing block, causing `position: fixed` children (e.g. back
 * buttons) to be positioned relative to the wrapper instead of the viewport.
 */
export default function PageWrapper({ children, config }: PageWrapperProps) {
  const direction = useNavDirection();
  const isForward = direction === 1;
  const wrapperRef = useRef<HTMLDivElement>(null);

  const initial = isForward ? config.enterFwd : config.enterBwd;
  const exit = isForward ? config.exitFwd : config.exitBwd;
  const transition = isForward ? spring.page : spring.back;

  // Only animate opacity and scale — x/y are handled via initial/exit transforms
  // that should NOT persist into the resting state.
  const animateTarget: Record<string, number> = {};
  for (const key of Object.keys(initial)) {
    if (key === "opacity") animateTarget[key] = 1;
    else if (key === "scale") animateTarget[key] = 1;
  }

  const hasSlide = Object.keys(initial).some((k) => k === "x" || k === "y");

  return (
    <motion.div
      ref={wrapperRef}
      data-motion-page
      initial={initial}
      animate={hasSlide ? { ...animateTarget, x: 0, y: 0 } : animateTarget}
      exit={exit}
      transition={transition}
      onAnimationComplete={() => {
        // Remove identity transform so fixed-position children
        // reference the viewport, not this wrapper.
        if (wrapperRef.current) {
          wrapperRef.current.style.transform = "";
        }
      }}
      style={{ height: "100%", overflow: "hidden" }}
    >
      {children}
    </motion.div>
  );
}
