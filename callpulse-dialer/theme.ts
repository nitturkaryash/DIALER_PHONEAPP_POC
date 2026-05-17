import { Platform } from "react-native";

const isWeb = Platform.OS === "web";

export const theme = {
  colors: {
    primary: "#6FA3D2",
    primaryGradient: ["#6FA3D2", "#89B9E3"] as [string, string],
    // warm off-white → cool pale blue-grey (design profile gradient canvas)
    backgroundGradient: ["#F9F9F4", "#EDF0F7"] as [string, string],
    accent: "#C3E836",
    bg: "#F9F9F4",
    card: "#FFFFFF",
    muted: "#F0F0EB",
    textPrimary: "#1A1A1A",
    textSecondary: "#757575",
    textTertiary: "#A0A0A0",
    success: "#10B981",
    error: "#EF4444",
    warning: "#F59E0B",
    border: "#E5E7EB",
  },
  fontSize: { xs: 11, sm: 12, base: 14, md: 16, lg: 18, xl: 24, "2xl": 32 },
  fontWeight: {
    light: "300",
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  } as const,
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    "2xl": 32,
    "3xl": 48,
    "4xl": 64,
    // design profile: screen_horizontal = 20, card_internal_padding = 20
    screen: 20,
    card: 20,
  },
  radius: { sm: 4, base: 8, md: 12, lg: 16, xl: 24, "2xl": 32, full: 9999 },
  shadow: {
    // design profile: 0 4px 24px rgba(0,0,0,0.06)
    card: isWeb
      ? { boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }
      : {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.06,
          shadowRadius: 24,
          elevation: 5,
        },
    button: isWeb
      ? { boxShadow: "0 2px 8px rgba(111,163,210,0.35)" }
      : {
          shadowColor: "#6FA3D2",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 4,
        },
  },
  transition: { fast: 150, base: 250, slow: 400 },
};

export type AppTheme = typeof theme;
