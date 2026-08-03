import type { Preset } from "./schema.js";

export type LayoutDimensions = { width: number; height: number };
export const SPOTIFY_FULL_LOGO_WIDTH_PX = 70;
const SAFE_AREA_CONTENT_FRACTION = .9;
const MINIMAL_MAX_SIZE_SOURCE_HEIGHT = 70;

export function getCompensatedSpotifyLogoWidth(scale: number): number {
  return SPOTIFY_FULL_LOGO_WIDTH_PX / Math.max(scale, .01);
}

const designDimensions: Record<Preset["layout"], LayoutDimensions> = {
  boxy: { width: 720, height: 108 },
  compact: { width: 570, height: 180 },
  portrait: { width: 400, height: 620 },
  minimal: { width: 950, height: 64 }
};

const recommendedSourceDimensions: Record<Preset["layout"], LayoutDimensions> = {
  boxy: { width: 740, height: 128 },
  compact: { width: 600, height: 200 },
  portrait: { width: 420, height: 640 },
  minimal: { width: 800, height: 100 }
};

export function getDesignDimensions(layout: Preset["layout"], coverMode: Preset["cover"]["mode"]): LayoutDimensions {
  if (layout === "portrait" && coverMode === "none") return { width: 400, height: 224 };
  return designDimensions[layout];
}

export function getRecommendedSourceDimensions(layout: Preset["layout"], coverMode: Preset["cover"]["mode"]): LayoutDimensions {
  if (layout === "portrait" && coverMode === "none") return { width: 420, height: 244 };
  return recommendedSourceDimensions[layout];
}

export function getLayoutScaleLimit(layout: Preset["layout"], coverMode: Preset["cover"]["mode"]): number {
  if (layout !== "minimal") return Number.POSITIVE_INFINITY;
  const design = getDesignDimensions(layout, coverMode);
  return MINIMAL_MAX_SIZE_SOURCE_HEIGHT * SAFE_AREA_CONTENT_FRACTION / design.height;
}
