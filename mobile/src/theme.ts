import { Platform } from "react-native";

/**
 * A small, deliberately plain design system.
 *
 * Two rules keep the app looking like an app rather than a web page: one
 * spacing scale used everywhere, and hairline borders instead of shadows —
 * Android elevation shadows look muddy at this density.
 */

export const palette = {
  light: {
    bg: "#f7fbfa",
    card: "#ffffff",
    border: "#e2e8e6",
    text: "#10221f",
    muted: "#5d6f6b",
    faint: "#8a9a96",
    accent: "#0f766e",
    accentSoft: "#d6f0ec",
    danger: "#b42318",
  },
  dark: {
    // AMOLED-friendly: pure-black surfaces.
    bg: "#000000",
    card: "#0a0a0a",
    border: "#1f1f1f",
    text: "#e8f0ee",
    muted: "#9aaba7",
    faint: "#6d7e7a",
    accent: "#2dd4bf",
    accentSoft: "#0d2a26",
    danger: "#f87171",
  },
} as const;

export type Theme = (typeof palette)["light"] | (typeof palette)["dark"];

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  regular: "HindSiliguri-Regular",
  semibold: "HindSiliguri-SemiBold",
} as const;

export const monoDigits = Platform.select({
  android: { fontVariant: ["tabular-nums"] },
  default: {},
}) as object;