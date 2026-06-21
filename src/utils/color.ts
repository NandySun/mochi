/**
 * Mochi 颜色工具 — 颜色温度判断
 *
 * 用于「颜色温度叙事」特性：系列切换时背景渐变 crossfade 的节奏
 * 取决于冷暖方向，而不是固定的对称过渡。
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

/** 从 CSS gradient 字符串提取中间色标的 RGBA */
function extractMidColor(gradient: string): RGB | null {
  // 匹配 "rgba(r, g, b, a)" 格式，取第二个色标（中间色）
  const matches = gradient.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g);
  const colors: RGB[] = [];
  for (const m of matches) {
    colors.push({ r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) });
  }
  if (colors.length === 0) return null;
  // 取中间位置的色标
  const mid = colors[Math.floor(colors.length / 2)];
  return mid;
}

/** RGB → HSL */
function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case rn:
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
      break;
    case gn:
      h = ((bn - rn) / d + 2) * 60;
      break;
    case bn:
      h = ((rn - gn) / d + 4) * 60;
      break;
  }

  return { h, s, l };
}

/**
 * 判断颜色温度。
 * 暖色区间：hue 0-60（红-黄）、hue 300-360（品红-红）
 * 冷色区间：hue 180-270（青-蓝-紫）
 * 中性区间：其余部分（绿、黄绿等）
 *
 * 返回 -1（冷）、0（中性）、1（暖）
 */
export function getColorTemp(gradient: string): -1 | 0 | 1 {
  const color = extractMidColor(gradient);
  if (!color) return 0;

  const { h, s } = rgbToHsl(color);
  // 低饱和度 = 接近灰色，视为中性
  if (s < 0.15) return 0;

  if (h <= 60 || h >= 300) return 1;
  if (h >= 180 && h <= 270) return -1;
  return 0;
}

/** 判断过渡方向：-1 = 变冷，1 = 变暖，0 = 同温 */
export function getTransitionDirection(
  oldGradient: string,
  newGradient: string,
): -1 | 0 | 1 {
  const oldTemp = getColorTemp(oldGradient);
  const newTemp = getColorTemp(newGradient);
  if (oldTemp === newTemp) return 0;
  return newTemp > oldTemp ? 1 : -1;
}

export type TempDirection = -1 | 0 | 1;
