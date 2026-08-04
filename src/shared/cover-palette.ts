import { blendHexColors, getContrastRatio } from "./color-contrast.js";

export type CoverPalette = {
  surface: string;
  accent: string;
  track: string;
  text: string;
  artistText: string;
};

type Rgb = { red: number; green: number; blue: number };
type Swatch = Rgb & { count: number; hue: number; saturation: number; lightness: number };

export const FALLBACK_COVER_PALETTE: CoverPalette = {
  surface: "#30333b",
  accent: "#39bde0",
  track: "#263d46",
  text: "#ffffff",
  artistText: "#d5d7da"
};

function toHex({ red, green, blue }: Rgb): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function colorMetrics(color: Rgb): { hue: number; saturation: number; lightness: number } {
  const maximum = Math.max(color.red, color.green, color.blue) / 255;
  const minimum = Math.min(color.red, color.green, color.blue) / 255;
  const lightness = (maximum + minimum) / 2;
  const range = maximum - minimum;
  const saturation = range === 0 ? 0 : range / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (range !== 0) {
    if (maximum === color.red / 255) hue = ((color.green - color.blue) / 255 / range) % 6;
    else if (maximum === color.green / 255) hue = (color.blue - color.red) / 255 / range + 2;
    else hue = (color.red - color.green) / 255 / range + 4;
    hue = ((hue * 60) + 360) % 360;
  }
  return { hue, saturation, lightness };
}

function normalizeSurface(color: string): string {
  const metrics = colorMetrics(parseHex(color));
  return toHex(hslToRgb(metrics.hue, Math.min(metrics.saturation, .42), Math.min(.29, Math.max(.19, metrics.lightness))));
}

function parseHex(color: string): Rgb {
  const value = Number.parseInt(color.slice(1), 16);
  return { red: value >> 16, green: value >> 8 & 0xff, blue: value & 0xff };
}

function colorDistance(first: Rgb, second: Rgb): number {
  return Math.hypot(first.red - second.red, first.green - second.green, first.blue - second.blue) / 441.67;
}

function hueDistance(first: number, second: number): number {
  const difference = Math.abs(first - second) % 360;
  return Math.min(difference, 360 - difference) / 180;
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const intermediate = chroma * (1 - Math.abs(section % 2 - 1));
  const [red, green, blue] = section < 1 ? [chroma, intermediate, 0]
    : section < 2 ? [intermediate, chroma, 0]
      : section < 3 ? [0, chroma, intermediate]
        : section < 4 ? [0, intermediate, chroma]
          : section < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  const match = lightness - chroma / 2;
  return { red: (red + match) * 255, green: (green + match) * 255, blue: (blue + match) * 255 };
}

function readableTint(accent: string, surface: string): string {
  const lightTarget = getContrastRatio("#ffffff", surface) >= getContrastRatio("#111318", surface) ? "#ffffff" : "#111318";
  for (let targetWeight = .08; targetWeight <= 1; targetWeight += .04) {
    const candidate = blendHexColors(lightTarget, accent, targetWeight);
    if (getContrastRatio(candidate, surface) >= 4.5) return candidate;
  }
  return lightTarget;
}

function softenReadableText(text: string, surface: string): string {
  let result = text;
  for (let surfaceWeight = .04; surfaceWeight <= .24; surfaceWeight += .02) {
    const candidate = blendHexColors(surface, text, surfaceWeight);
    if (getContrastRatio(candidate, surface) < 4.5) break;
    result = candidate;
  }
  return result;
}

export function extractCoverPalette(pixels: ArrayLike<number>): CoverPalette {
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>();

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (alpha < 180) continue;
    const lightness = (Math.max(red, green, blue) + Math.min(red, green, blue)) / 510;
    if (lightness < .025 || lightness > .975) continue;
    const key = `${red >> 4}-${green >> 4}-${blue >> 4}`;
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(key, bucket);
  }

  const swatches: Swatch[] = [...buckets.values()].map((bucket) => {
    const color = {
      red: bucket.red / bucket.count,
      green: bucket.green / bucket.count,
      blue: bucket.blue / bucket.count
    };
    return { ...color, ...colorMetrics(color), count: bucket.count };
  });
  if (!swatches.length) return FALLBACK_COVER_PALETTE;

  const dominant = [...swatches].sort((first, second) => {
    const firstScore = first.count * (.78 + first.saturation * .22);
    const secondScore = second.count * (.78 + second.saturation * .22);
    return secondScore - firstScore;
  })[0];
  const surface = normalizeSurface(toHex(dominant));
  const surfaceRgb = parseHex(surface);
  const colorful = swatches.some((swatch) => swatch.saturation >= .28);
  const accentSwatch = [...swatches].sort((first, second) => {
    const score = (swatch: Swatch) => swatch.count ** .22
      * (.3 + (colorful ? swatch.saturation * 2.8 : swatch.lightness * 1.6))
      * (.3 + colorDistance(swatch, surfaceRgb))
      * (.42 + hueDistance(swatch.hue, dominant.hue))
      * (swatch.lightness < .1 || swatch.lightness > .9 ? .22 : 1)
      * (.65 + (1 - Math.abs(swatch.lightness - .55)));
    return score(second) - score(first);
  })[0];
  const accentSaturation = colorful
    ? Math.min(.82, Math.max(.46, accentSwatch.saturation))
    : accentSwatch.saturation;
  const accentLightness = Math.min(.64, Math.max(.42, accentSwatch.lightness));
  let accent = toHex(hslToRgb(accentSwatch.hue, accentSaturation, accentLightness));
  if (getContrastRatio(accent, surface) < 2.1) {
    const target = getContrastRatio("#ffffff", surface) > getContrastRatio("#111318", surface) ? "#ffffff" : "#111318";
    accent = blendHexColors(target, accent, .28);
  }
  const text = readableTint(accent, surface);

  return {
    surface,
    accent,
    track: blendHexColors(accent, surface, .22),
    text,
    artistText: softenReadableText(text, surface)
  };
}
