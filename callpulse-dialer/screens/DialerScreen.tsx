import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";

import { useRootNavigation } from "../navigation/useRootNavigation";
import { AuthError, getToken, initiateOutboundCall } from "../services/api";
import { useAgentStatus } from "../state/AgentStatusContext";
import { theme } from "../theme";
import { formatPhoneDisplay, isValidDialLength, normalizePhone } from "../utils/phone";

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

/** Strip everything except digits, *, # from a possibly-formatted pasted string. */
function sanitizeInput(text: string): string {
  return (text || "").replace(/[^\d*#]/g, "").slice(0, 15);
}

export default function DialerScreen() {
  const navigation = useRootNavigation();
  const { width } = useWindowDimensions();
  const { isOnBreak } = useAgentStatus();
  const [digits, setDigits] = useState("");
  const [customerName, setCustomerName] = useState("Manual Dial");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<TextInput>(null);
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

  const onKey = useCallback(
    (key: string | "back") => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
      bumpLayout();
      if (error) setError("");
      if (key === "back") {
        setDigits((prev) => prev.slice(0, -1));
        return;
      }
      setDigits((prev) => sanitizeInput(prev + key));
    },
    [error]
  );

  const onClearAll = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }
    bumpLayout();
    setDigits("");
    setError("");
  }, []);

  const onInputChange = useCallback((text: string) => {
    // Pasted / typed text — extract valid characters only.
    setDigits(sanitizeInput(text));
    setError("");
  }, []);

  const onCall = async () => {
    if (isOnBreak) {
      setError("End your break before placing a call.");
      return;
    }
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
      const trimmedName = customerName.trim() || "Manual Dial";
      const result = await initiateOutboundCall(token, {
        phone_number: phone,
        customer_name: trimmedName,
        handler: "human",
      });
      navigation.navigate("HumanCall", {
        callId: result.call_id,
        phone,
        customerName: trimmedName,
      });
    } catch (e) {
      if (e instanceof AuthError) {
        navigation.replace("Login");
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to start call");
    } finally {
      setLoading(false);
    }
  };

  const display = formatPhoneDisplay(digits);
  const canCall = isValidDialLength(digits) && !loading && !isOnBreak;
  const normalized = normalizePhone(digits);

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
          <View style={styles.headerBlock}>
            <Text style={styles.eyebrow}>Manual dial</Text>
            <Text style={styles.title}>Dial a customer</Text>
          </View>

          {Platform.OS !== "web" ? (
            <View style={styles.infoBanner}>
              <Feather name="info" size={16} color={theme.colors.primary} />
              <Text style={styles.infoBannerText}>
                Live calls need an EAS dev build with Commons PCM modules (not Expo Go).
              </Text>
            </View>
          ) : null}

          {isOnBreak ? (
            <View style={styles.breakBanner}>
              <Feather name="alert-triangle" size={16} color={theme.colors.warning} />
              <Text style={styles.breakBannerText}>You're on break — end it before dialing.</Text>
            </View>
          ) : null}

          {/* Number display: editable so user can paste / edit. Keypad below also appends. */}
          <View style={styles.displayCard}>
            <Pressable
              onPress={() => inputRef.current?.focus()}
              style={styles.displayRow}
              accessibilityRole="button"
              accessibilityLabel="Phone number input"
            >
              <TextInput
                ref={inputRef}
                style={[styles.display, compact && styles.displayCompact]}
                value={display}
                onChangeText={onInputChange}
                placeholder="Enter number"
                placeholderTextColor={theme.colors.textTertiary}
                keyboardType="phone-pad"
                showSoftInputOnFocus={false} // on-screen keypad is the primary input
                selectTextOnFocus
                numberOfLines={1}
                allowFontScaling={false}
                autoCorrect={false}
                autoComplete="tel"
                textContentType="telephoneNumber"
              />
              {digits.length > 0 ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Clear number"
                  onPress={onClearAll}
                  style={styles.clearBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </Pressable>
            <View style={styles.displayHintRow}>
              <Feather name="hash" size={12} color={theme.colors.textTertiary} />
              <Text style={styles.displayHint}>
                {normalized || "Long-press to paste a number"}
              </Text>
            </View>
          </View>

          <View style={styles.nameInputWrap}>
            <Feather name="user" size={16} color={theme.colors.textTertiary} />
            <TextInput
              style={styles.nameInput}
              value={customerName}
              onChangeText={setCustomerName}
              placeholder="Contact name"
              placeholderTextColor={theme.colors.textTertiary}
              returnKeyType="done"
            />
          </View>

          {!!error && (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={14} color={theme.colors.error} />
              <Text style={styles.error}>{error}</Text>
            </View>
          )}

          <View style={styles.keypad}>
            {KEYPAD.map((entry) => (
              <TouchableOpacity
                key={entry.key}
                activeOpacity={0.7}
                style={[styles.key, keySize]}
                onPress={() => onKey(entry.key)}
              >
                <Text style={[styles.keyText, compact && styles.keyTextCompact]}>{entry.key}</Text>
                {!!entry.sub && <Text style={styles.keySub}>{entry.sub}</Text>}
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.actionRow}>
            <View style={styles.actionSpacer} />
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
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Feather name="phone" size={28} color="#fff" />
                )}
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={() => onKey("back")}
              onLongPress={onClearAll}
              style={styles.backspaceBtn}
              accessibilityRole="button"
              accessibilityLabel="Backspace (long-press to clear)"
              disabled={digits.length === 0}
            >
              <Ionicons
                name="backspace-outline"
                size={26}
                color={digits.length > 0 ? theme.colors.textPrimary : theme.colors.textTertiary}
              />
            </TouchableOpacity>
          </View>

          <Text style={styles.footerHint}>
            Long-press anywhere on the keypad backspace to clear · paste from clipboard via long-press on the number
          </Text>
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
  headerBlock: {
    marginBottom: theme.spacing.lg,
  },
  eyebrow: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textTertiary,
    letterSpacing: theme.letterSpacing.caps,
    textTransform: "uppercase",
  },
  title: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textPrimary,
    letterSpacing: theme.letterSpacing.tight,
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    marginBottom: theme.spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
  },
  infoBannerText: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 20,
  },
  breakBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.warningSoft,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    marginBottom: theme.spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.warning,
  },
  breakBannerText: {
    flex: 1,
    color: theme.colors.warning,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  displayCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md + 2,
    marginBottom: theme.spacing.md,
    ...theme.shadow.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  displayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  display: {
    flex: 1,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
    letterSpacing: 1,
    minHeight: 44,
    paddingVertical: 0,
    textAlign: "left",
  },
  displayCompact: {
    fontSize: theme.fontSize.xl,
  },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  displayHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  displayHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
    fontVariant: ["tabular-nums"],
  },
  nameInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.lg,
    height: 48,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  nameInput: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.textPrimary,
    paddingVertical: 0,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
  },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: theme.spacing.lg,
    rowGap: theme.spacing.sm,
  },
  key: {
    minWidth: 72,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  keyText: {
    fontSize: 30,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.textPrimary,
    lineHeight: 36,
  },
  keyTextCompact: {
    fontSize: 26,
  },
  keySub: {
    marginTop: -4,
    fontSize: 10,
    letterSpacing: 1.5,
    color: theme.colors.textTertiary,
    fontWeight: theme.fontWeight.semibold,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: theme.spacing.sm,
  },
  actionSpacer: {
    width: 56,
  },
  callWrap: {
    width: 80,
    height: 80,
  },
  callBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.button,
  },
  callDisabled: { opacity: 0.55 },
  backspaceBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  footerHint: {
    marginTop: theme.spacing.lg,
    fontSize: theme.fontSize.xs,
    color: theme.colors.textTertiary,
    textAlign: "center",
    lineHeight: 16,
  },
});
