/* Hallmark · macrostructure: Workbench · tone: utilitarian · theme: Quiet (modern-minimal) */

import { Platform } from "react-native";

const isWeb = Platform.OS === "web";

export const theme = {
  colors: {
    primary: "#1B4D8C",
    primarySoft: "#E8EFF8",
    primaryPressed: "#153D6F",
    bg: "#F6F7F9",
    card: "#FFFFFF",
    surfaceMuted: "#EEF1F5",
    muted: "#EEF1F5",
    textPrimary: "#0F172A",
    textSecondary: "#5B6472",
    textTertiary: "#8B95A5",
    success: "#0D7A55",
    successSoft: "#E6F4EE",
    error: "#C53030",
    errorSoft: "#FCEBEB",
    warning: "#B45309",
    warningSoft: "#FEF3E2",
    border: "#DDE2E8",
    borderStrong: "#C5CDD8",
    focusRing: "#1B4D8C",
    chartConnected: "#3B82C4",
    chartQualified: "#5B8DEF",
    overlay: "rgba(15, 23, 42, 0.04)",
    /** @deprecated Use flat `bg` + ScreenChrome — kept for screens not yet migrated */
    accent: "#5B8DEF",
    backgroundGradient: ["#F6F7F9", "#F6F7F9"] as [string, string],
    primaryGradient: ["#1B4D8C", "#2563A8"] as [string, string],
  },
  fontSize: { xs: 11, sm: 12, base: 14, md: 16, lg: 18, xl: 22, "2xl": 28, display: 34 },
  fontWeight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
  letterSpacing: {
    tight: -0.4,
    normal: 0,
    wide: 0.6,
    caps: 1.2,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    "2xl": 32,
    "3xl": 48,
    screen: 20,
    card: 18,
  },
  radius: { sm: 6, base: 10, md: 12, lg: 16, xl: 20, full: 9999 },
  shadow: {
    card: isWeb
      ? { boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.06)" }
      : {
          shadowColor: "#0F172A",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.06,
          shadowRadius: 16,
          elevation: 3,
        },
    button: isWeb
      ? { boxShadow: "0 1px 2px rgba(27, 77, 140, 0.2)" }
      : {
          shadowColor: "#1B4D8C",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.18,
          shadowRadius: 6,
          elevation: 2,
        },
  },
  transition: { fast: 150, base: 220, slow: 360 },
};

export type AppTheme = typeof theme;
