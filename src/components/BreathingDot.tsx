import { motion } from "framer-motion";

// ── BreathingDot ─────────────────────────────────────────────────────────
// Mochi 设计语言中唯一的加载态符号：轻轻呼吸的圆。
// 材质物理依据：形变可逆（呼吸后回归原位）、运动有质量（ease-in-out 平滑周期）。
//
// 场景分级：
//   size=16  海报懒加载、短操作（<2s）
//   size=24  元数据拉取（3-15s）
//   size=48  全库扫描（>15s）

interface BreathingDotProps {
  /** 圆的直径，px。默认 16 */
  size?: number;
  /** 圆的颜色。默认暖米色 */
  color?: string;
  /** 呼吸周期（完整膨胀→收缩→膨胀），秒。默认 2 */
  period?: number;
  /** CSS margin / position override */
  style?: React.CSSProperties;
}

export function BreathingDot({
  size = 16,
  color = "rgba(212,165,116,0.7)",
  period = 2,
  style,
}: BreathingDotProps) {
  return (
    <motion.div
      animate={{ scale: [1, 1.15, 1] }}
      transition={{
        duration: period,
        repeat: Infinity,
        ease: "easeInOut",
      }}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

