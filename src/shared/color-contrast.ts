export type ThemeName = "dark" | "light";

type Rgb = { red: number; green: number; blue: number };

const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#111318";
const THEME_PANEL: Record<ThemeName, string> = {
  dark: "#141519",
  light: "#f0f1f3"
};

function parseHexColor(color: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return {
    red: value >> 16,
    green: value >> 8 & 0xff,
    blue: value & 0xff
  };
}

function toHexColor(color: Rgb): string {
  return `#${[color.red, color.green, color.blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function blendHexColors(foreground: string, background: string, foregroundWeight: number): string {
  const foregroundRgb = parseHexColor(foreground);
  const backgroundRgb = parseHexColor(background);
  if (!foregroundRgb || !backgroundRgb) return background;
  const weight = Math.min(1, Math.max(0, foregroundWeight));
  return toHexColor({
    red: foregroundRgb.red * weight + backgroundRgb.red * (1 - weight),
    green: foregroundRgb.green * weight + backgroundRgb.green * (1 - weight),
    blue: foregroundRgb.blue * weight + backgroundRgb.blue * (1 - weight)
  });
}

function relativeLuminance(color: string): number {
  const rgb = parseHexColor(color) ?? { red: 0, green: 0, blue: 0 };
  const channels = [rgb.red, rgb.green, rgb.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
  });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

export function getContrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + .05) / (darker + .05);
}

function softenTextColor(textColor: string, backgroundColor: string, minimumContrast: number): string {
  let result = textColor;
  for (let backgroundWeight = .02; backgroundWeight <= .36; backgroundWeight += .02) {
    const candidate = blendHexColors(backgroundColor, textColor, backgroundWeight);
    if (getContrastRatio(candidate, backgroundColor) < minimumContrast) break;
    result = candidate;
  }
  return result;
}

export function getAutomaticTextStyle(theme: ThemeName, coverColor: string, coverTintEnabled: boolean): { color: string; artistColor: string; shadow: string; filter: string } {
  const panelColor = THEME_PANEL[theme];
  const estimatedBackground = coverTintEnabled
    ? blendHexColors(coverColor, panelColor, .62)
    : panelColor;
  const color = getContrastRatio(LIGHT_TEXT, estimatedBackground) >= getContrastRatio(DARK_TEXT, estimatedBackground)
    ? LIGHT_TEXT
    : DARK_TEXT;
  const shadowColor = color === LIGHT_TEXT ? "#000000" : "#ffffff";
  const firstShadow = hexToRgba(shadowColor, .92);
  const secondShadow = hexToRgba(shadowColor, .62);
  return {
    color,
    artistColor: softenTextColor(color, estimatedBackground, 4.5),
    shadow: `0 1px 2px ${firstShadow}, 0 0 5px ${secondShadow}`,
    filter: `drop-shadow(0 1px 2px ${firstShadow}) drop-shadow(0 0 5px ${secondShadow})`
  };
}

export function getDerivedProgressTrackColor(accentColor: string, theme: ThemeName): string {
  return blendHexColors(accentColor, THEME_PANEL[theme], theme === "dark" ? .34 : .22);
}

export function hexToRgba(color: string, opacity: number): string {
  const rgb = parseHexColor(color) ?? { red: 0, green: 0, blue: 0 };
  const alpha = Math.min(1, Math.max(0, opacity));
  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${alpha.toFixed(2)})`;
}
