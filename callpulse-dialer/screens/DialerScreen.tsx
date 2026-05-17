import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

import { useRootNavigation } from "../navigation/useRootNavigation";
import { AuthError, clearToken, createHumanAgentCall, getToken } from "../services/api";
import { theme } from "../theme";
import { digitsOnly, formatPhoneDisplay, isValidDialLength, normalizePhone } from "../utils/phone";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const KEYPAD: Array<{ key: string; sub?: string }> = [
  { key: "1" },
  { key: "2", sub: "ABC" },
  { key: "3", sub: "DEF" },
  { key: "4", sub: "GHI" },
  { key: "5", sub: "JKL" },
  { key: "6", sub: "MNO" },
  { key: "7", sub: "PQRS" },
  { key: "8", sub: "TUV" },
  { key: "9", sub: "WXYZ" },
  { key: "*" },
  { key: "0", sub: "+" },
  { key: "#" },
];

export default function DialerScreen() {
  const navigation = useRootNavigation();
  const { width } = useWindowDimensions();
  const [digits, setDigits] = useState("");
  const [customerName, setCustomerName] = useState("Manual Dial");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const compact = width < 380;

  const contentMaxWidth = useMemo(() => Math.min(560, width - theme.spacing.screen * 2), [width]);
  const keySize = useMemo(() => {
    const gap = compact ? 12 : 16;
    const keypadWidth = Math.min(contentMaxWidth, compact ? 320 : 360);
    const keyWidth = Math.floor((keypadWidth - gap * 2) / 3);
    return {
      width: keyWidth,
      height: keyWidth,
    };
  }, [compact, contentMaxWidth]);

  const bumpLayout = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const onKey = useCallback((key: string | "back") => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    bumpLayout();
    if (key === "back") {
      setDigits((prev) => prev.slice(0, -1));
      return;
    }
    if (digitsOnly(digits).length >= 15) return;
    setDigits((prev) => prev + key);
  }, [digits]);

  const onCall = async () => {
    if (!isValidDialLength(digits)) {
      setError("Enter at least 10 digits");
      return;
    }
    const phone = normalizePhone(digits);
    if (!phone) {
      setError("Invalid phone number");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const token = await getToken();
      if (!token) {
        navigation.replace("Login");
        return;
      }
      const result = await createHumanAgentCall(token, {
        phone_number: phone,
        customer_name: customerName.trim() || "Manual Dial",
        provider: "auto",
      });
      navigation.navigate("HumanCall", {
        callId: result.call_id,
        phone,
        customerName: customerName.trim() || "Manual Dial",
        livekitUrl: result.livekit_url,
        agentToken: result.agent_token,
        roomName: result.room_name,
      });
    } catch (e) {
      if (e instanceof AuthError) {
        await clearToken();
        navigation.replace("Login");
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to start call");
    } finally {
      setLoading(false);
    }
  };

  const display = formatPhoneDisplay(digits);
  const canCall = isValidDialLength(digits) && !loading;

  return (
    <LinearGradient
      colors={theme.colors.backgroundGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.container, { maxWidth: contentMaxWidth }]}>
          <Text style={styles.title}>Dial</Text>
          <Text style={styles.subtitle}>Enter a number for a live agent call (your microphone)</Text>

          <View style={styles.displayCard}>
            <Text style={[styles.display, compact && styles.displayCompact]} numberOfLines={1}>
              {display || " "}
            </Text>
            <Text style={styles.displayHint}>{normalizePhone(digits) || "Phone number"}</Text>
          </View>

          <TextInput
            style={styles.nameInput}
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="Contact name"
            placeholderTextColor={theme.colors.textTertiary}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.keypad}>
            {KEYPAD.map((entry) => {
              return (
                <TouchableOpacity
                  key={entry.key}
                  activeOpacity={0.85}
                  style={[styles.key, keySize]}
                  onPress={() => onKey(entry.key)}
                >
                  <Text style={[styles.keyText, compact && styles.keyTextCompact]}>{entry.key}</Text>
                  {!!entry.sub && <Text style={styles.keySub}>{entry.sub}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.backspaceBtn}
            onPress={() => onKey("back")}
            onLongPress={() => setDigits("")}
          >
            <Text style={styles.backspaceText}>⌫</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onCall}
            disabled={!canCall}
            style={[styles.callWrap, !canCall ? styles.callDisabled : undefined]}
          >
            <LinearGradient
              colors={canCall ? theme.colors.primaryGradient : [theme.colors.muted, theme.colors.muted]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.callBtn}
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.card} />
              ) : (
                <Text style={styles.callBtnText}>Call</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: theme.spacing.lg,
  },
  container: {
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  subtitle: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.lg,
  },
  displayCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    alignItems: "center",
    ...theme.shadow.card,
  },
  display: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "600",
    color: theme.colors.textPrimary,
    letterSpacing: 1,
    minHeight: 40,
  },
  displayCompact: {
    fontSize: theme.fontSize.xl,
  },
  displayHint: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
  },
  nameInput: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.full,
    height: 44,
    paddingHorizontal: theme.spacing.lg,
    fontSize: theme.fontSize.base,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing.sm,
  },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: theme.spacing.lg,
  },
  key: {
    minWidth: 72,
    marginBottom: theme.spacing.sm,
    backgroundColor: "#F1F1F1",
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E6E6E6",
  },
  keyText: {
    fontSize: 34,
    fontWeight: "400",
    color: "#111111",
  },
  keyTextCompact: {
    fontSize: 30,
  },
  keySub: {
    marginTop: -2,
    fontSize: theme.fontSize.xs,
    letterSpacing: 1,
    color: "#111111",
    fontWeight: "600",
  },
  backspaceBtn: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  backspaceText: {
    fontSize: 22,
    color: theme.colors.textPrimary,
  },
  callWrap: {
    marginTop: theme.spacing.xs,
  },
  callBtn: {
    height: 52,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.button,
  },
  callDisabled: { opacity: 0.7 },
  callBtnText: {
    color: theme.colors.card,
    fontSize: theme.fontSize.md,
    fontWeight: "600",
  },
});
