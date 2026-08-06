import { z } from "zod";
import { MAIN_PRESET_ID, MAX_PRESET_COUNT } from "./profiles.js";

export const LayoutSchema = z.enum(["compact", "boxy", "portrait", "minimal"]);
export const ThemeSchema = z.enum(["dark", "light"]);
const legacyAnimationMap: Record<string, "fade"> = {
  grow: "fade",
  shrink: "fade",
  "swing-left": "fade",
  "tilt-left": "fade",
  "swing-right": "fade",
  "tilt-right": "fade",
  "slide-left": "fade",
  "slide-right": "fade",
  "slide-top": "fade",
  "slide-bottom": "fade"
};

export const AnimationSchema = z.preprocess(
  (animation) => typeof animation === "string" ? legacyAnimationMap[animation] ?? animation : animation,
  z.enum(["none", "fade"])
);
export const CoverModeSchema = z.enum(["square", "none"]);
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const TextStyleSchema = z.object({
  color: HexColorSchema.nullable().default(null),
  autoContrast: z.boolean().default(false),
  shadow: z.object({
    enabled: z.boolean().default(false),
    color: HexColorSchema.default("#000000"),
    opacity: z.number().int().min(0).max(100).default(65),
    blur: z.number().int().min(0).max(12).default(3)
  }).default({ enabled: false, color: "#000000", opacity: 65, blur: 3 })
}).default({
  color: null,
  autoContrast: false,
  shadow: { enabled: false, color: "#000000", opacity: 65, blur: 3 }
});

const ProgressStyleSchema = z.preprocess((progressStyle) => {
  if (!progressStyle || typeof progressStyle !== "object") return progressStyle;
  const legacy = progressStyle as Record<string, unknown>;
  if (typeof legacy.customTrackColor === "boolean") return progressStyle;
  return {
    ...legacy,
    customTrackColor: typeof legacy.trackColor === "string",
    trackColor: typeof legacy.trackColor === "string" ? legacy.trackColor : "#f5f5f5"
  };
}, z.object({
  customTrackColor: z.boolean().default(false),
  trackColor: HexColorSchema.default("#f5f5f5")
})).default({ customTrackColor: false, trackColor: "#f5f5f5" });

const WidgetInsetStyleSchema = z.preprocess((insetStyle) => {
  if (!insetStyle || typeof insetStyle !== "object") return insetStyle;
  const legacy = insetStyle as Record<string, unknown>;
  if (typeof legacy.customColor === "boolean") return insetStyle;
  return {
    ...legacy,
    customColor: typeof legacy.color === "string",
    color: typeof legacy.color === "string" ? legacy.color : "#000000"
  };
}, z.object({
  enabled: z.boolean().default(true),
  customColor: z.boolean().default(false),
  color: HexColorSchema.default("#000000"),
  opacity: z.number().int().min(0).max(100).default(100),
  width: z.number().int().min(1).max(4).default(1)
})).default({ enabled: true, customColor: false, color: "#000000", opacity: 100, width: 1 });

const WidgetStyleSchema = z.preprocess((widgetStyle) => {
  if (!widgetStyle || typeof widgetStyle !== "object") return widgetStyle;
  const legacy = widgetStyle as Record<string, unknown>;
  if (legacy.inset) return widgetStyle;
  const legacyOutline = legacy.outline && typeof legacy.outline === "object"
    ? legacy.outline as Record<string, unknown>
    : null;
  return {
    ...legacy,
    inset: {
      enabled: typeof legacyOutline?.enabled === "boolean" ? legacyOutline.enabled : true,
      customColor: false,
      color: "#000000",
      opacity: 100,
      width: 1
    }
  };
}, z.object({
  surfaceOpacity: z.number().int().min(0).max(100).default(100),
  outline: z.object({
    enabled: z.boolean().default(true),
    color: HexColorSchema.nullable().default(null),
    opacity: z.number().int().min(0).max(100).default(100),
    width: z.number().int().min(1).max(4).default(1)
  }).default({ enabled: true, color: null, opacity: 100, width: 1 }),
  inset: WidgetInsetStyleSchema,
  shadow: z.object({
    enabled: z.boolean().default(true),
    color: HexColorSchema.nullable().default(null),
    opacity: z.number().int().min(0).max(100).default(100),
    blur: z.number().int().min(0).max(30).default(9)
  }).default({ enabled: true, color: null, opacity: 100, blur: 9 })
})).default({
  surfaceOpacity: 100,
  outline: { enabled: true, color: null, opacity: 100, width: 1 },
  inset: { enabled: true, customColor: false, color: "#000000", opacity: 100, width: 1 },
  shadow: { enabled: true, color: null, opacity: 100, blur: 9 }
});

const CoverPaletteSchema = z.object({
  enabled: z.boolean().default(false)
}).default({ enabled: false });

const EmptyStateMediaSchema = z.object({
  enabled: z.boolean().default(false),
  kind: z.enum(["image", "video"]).nullable().default(null),
  crop: z.boolean().default(false),
  positionX: z.number().int().min(0).max(100).default(50),
  positionY: z.number().int().min(0).max(100).default(50),
  zoom: z.number().min(1).max(3).default(1),
  revision: z.number().int().nonnegative().default(0)
});

const CoverSchema = z.preprocess((cover) => {
  if (!cover || typeof cover !== "object") return cover;
  const legacy = cover as Record<string, unknown>;
  if (legacy.mode) return cover;
  return { ...legacy, mode: legacy.visible === false ? "none" : "square" };
}, z.object({
  mode: CoverModeSchema,
  glow: z.boolean()
}));

export const PresetSchema = z.object({
  name: z.string().min(1).max(40),
  layout: LayoutSchema,
  theme: ThemeSchema,
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textStyle: TextStyleSchema,
  progressStyle: ProgressStyleSchema,
  widgetStyle: WidgetStyleSchema,
  coverPalette: CoverPaletteSchema,
  fontFamily: z.string().min(1).max(100),
  fontSource: z.enum(["local", "google"]).default("local"),
  cover: CoverSchema,
  visibility: z.object({
    hideOnPause: z.boolean(),
    hideDelaySeconds: z.number().int().min(0).max(60),
    songChangeOnly: z.boolean(),
    visibleDurationSeconds: z.number().int().min(1).max(60)
  }),
  visualizer: z.object({
    visible: z.boolean()
  }),
  animations: z.object({
    enter: AnimationSchema,
    exit: AnimationSchema
  }),
  emptyState: z.object({
    title: z.string().max(80),
    artist: z.string().max(80),
    useLastPlayback: z.boolean().default(false),
    dim: z.object({
      enabled: z.boolean().default(false),
      percent: z.number().int().min(0).max(90).default(35)
    }).default({ enabled: false, percent: 35 }),
    media: EmptyStateMediaSchema.default({
      enabled: false,
      kind: null,
      crop: false,
      positionX: 50,
      positionY: 50,
      zoom: 1,
      revision: 0
    })
  })
});

export const AppConfigSchema = z.object({
  version: z.literal(1),
  language: z.enum(["auto", "de", "en"]).default("auto"),
  server: z.object({ port: z.number().int().min(1024).max(65535) }),
  spotify: z.object({
    clientId: z.string().max(128),
    authorizedAt: z.string().datetime().nullable()
  }),
  activePreset: z.string(),
  presets: z.record(z.string(), PresetSchema)
}).superRefine((value, context) => {
  if (!value.presets[MAIN_PRESET_ID]) context.addIssue({
    code: "custom",
    message: "The main preset must exist.",
    path: ["presets", MAIN_PRESET_ID]
  });
  if (!value.presets[value.activePreset]) context.addIssue({
    code: "custom",
    message: "The active preset must exist.",
    path: ["activePreset"]
  });
  if (Object.keys(value.presets).length > MAX_PRESET_COUNT) context.addIssue({
    code: "custom",
    message: `At most ${MAX_PRESET_COUNT} presets are allowed.`,
    path: ["presets"]
  });
}).transform((value) => ({ ...value, activePreset: MAIN_PRESET_ID }));

export type Preset = z.infer<typeof PresetSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

export type PlaybackStatus = "not_authorized" | "checking" | "ready" | "idle" | "rate_limited" | "reauthorize" | "error";

export type PlaybackItem = {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
  spotifyUrl: string;
};

export type PlaybackState = {
  connected: boolean;
  status: PlaybackStatus;
  error: string | null;
  retryAt: number | null;
  isPlaying: boolean;
  progressMs: number;
  observedAt: number;
  item: PlaybackItem | null;
  lastPlayback: { item: PlaybackItem; progressMs: number } | null;
};

export type ServerMessage =
  | { type: "snapshot"; config: AppConfig; playback: PlaybackState }
  | { type: "config"; config: AppConfig }
  | { type: "playback"; playback: PlaybackState };

export const defaultConfig: AppConfig = {
  version: 1,
  language: "auto",
  server: { port: 3847 },
  spotify: { clientId: "", authorizedAt: null },
  activePreset: "main",
  presets: {
    main: {
      name: "Main",
      layout: "boxy",
      theme: "dark",
      accentColor: "#39bde0",
      textStyle: {
        color: null,
        autoContrast: false,
        shadow: { enabled: false, color: "#000000", opacity: 65, blur: 3 }
      },
      progressStyle: { customTrackColor: false, trackColor: "#f5f5f5" },
      widgetStyle: {
        surfaceOpacity: 100,
        outline: { enabled: true, color: null, opacity: 100, width: 1 },
        inset: { enabled: true, customColor: false, color: "#000000", opacity: 100, width: 1 },
        shadow: { enabled: true, color: null, opacity: 100, blur: 9 }
      },
      coverPalette: { enabled: false },
      fontFamily: "Poppins",
      fontSource: "local",
      cover: { mode: "square", glow: false },
      visibility: {
        hideOnPause: false,
        hideDelaySeconds: 0,
        songChangeOnly: false,
        visibleDurationSeconds: 8
      },
      visualizer: { visible: true },
      animations: { enter: "fade", exit: "fade" },
      emptyState: {
        title: "Nothing Playing",
        artist: "Start the music",
        useLastPlayback: false,
        dim: { enabled: false, percent: 35 },
        media: { enabled: false, kind: null, crop: false, positionX: 50, positionY: 50, zoom: 1, revision: 0 }
      }
    }
  }
};
