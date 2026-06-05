/* CallPulse · agent dialer · forest + slate palette */

import { Platform } from "react-native";

const isWeb = Platform.OS === "web";

export const theme = {
  colors: {
    primary: "#1B5E4A",
    primarySoft: "#E6F2ED",
    primaryPressed: "#144536",
    bg: "#F4F6F5",
    card: "#FFFFFF",
    surfaceMuted: "#EEF2F0",
    muted: "#E8EDEA",
    textPrimary: "#0F1A17",
    textSecondary: "#5C6B66",
    textTertiary: "#8A9892",
    success: "#0D7A55",
    successSoft: "#E6F4EE",
    error: "#C53030",
    errorSoft: "#FCEBEB",
    warning: "#B45309",
    warningSoft: "#FEF3E2",
    border: "#D8E0DC",
    borderStrong: "#B8C5BE",
    focusRing: "#1B5E4A",
    chartConnected: "#3B9E7A",
    chartQualified: "#5BA88A",
    overlay: "rgba(15, 26, 23, 0.05)",
    accent: "#C9A66B",
    accentSoft: "#F5EDE0",
    backgroundGradient: ["#F4F6F5", "#F8FAF9"] as [string, string],
    primaryGradient: ["#1B5E4A", "#2A7A65"] as [string, string],
    heroGradient: ["#1B5E4A", "#256B58", "#2E7D68"] as [string, string, string],
    chat: {
      header: "#1B5E4A",
      headerMuted: "#2A6B58",
      searchBg: "rgba(255,255,255,0.14)",
      sheet: "#FFFFFF",
      bubbleOut: "#D9F0E4",
      bubbleIn: "#FFFFFF",
      wallpaper: "#E8EDE9",
      online: "#22C55E",
      unread: "#C9A66B",
      unreadText: "#4A3520",
    },
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
  radius: { sm: 6, base: 10, md: 12, lg: 16, xl: 20, "2xl": 24, full: 9999 },
  shadow: {
    card: isWeb
      ? { boxShadow: "0 1px 2px rgba(15, 26, 23, 0.05), 0 8px 24px rgba(15, 26, 23, 0.07)" }
      : {
          shadowColor: "#0F1A17",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.07,
          shadowRadius: 16,
          elevation: 3,
        },
    button: isWeb
      ? { boxShadow: "0 2px 8px rgba(27, 94, 74, 0.28)" }
      : {
          shadowColor: "#1B5E4A",
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.22,
          shadowRadius: 8,
          elevation: 3,
        },
    tabBar: isWeb
      ? { boxShadow: "0 -4px 24px rgba(15, 26, 23, 0.08)" }
      : {
          shadowColor: "#0F1A17",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.08,
          shadowRadius: 16,
          elevation: 12,
        },
  },
  transition: { fast: 150, base: 220, slow: 360 },
};

export type AppTheme = typeof theme;
