import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useRootNavigation } from "../navigation/useRootNavigation";
import { AuthError, getToken, initiateOutboundCall } from "../services/api";
import { useAgentStatus } from "../state/AgentStatusContext";
import { formatPhoneDisplay, isValidDialLength, normalizePhone } from "../utils/phone";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** iOS Phone–inspired dialer palette */
const D = {
  bg: "#F2F2F7",
  key: "#FFFFFF",
  keyPressed: "#E5E5EA",
  keyBorder: "rgba(0,0,0,0.04)",
  digit: "#1C1C1E",
  letters: "#8E8E93",
  placeholder: "#AEAEB2",
  call: "#34C759",
  callPressed: "#2DB350",
  callDisabled: "#C7C7CC",
  error: "#FF3B30",
  banner: "rgba(255,149,0,0.12)",
  bannerText: "#C93400",
};

const KEY_ROWS: Array<Array<{ key: string; sub?: string }>> = [
  [
    { key: "1" },
    { key: "2", sub: "ABC" },
    { key: "3", sub: "DEF" },
  ],
  [
    { key: "4", sub: "GHI" },
    { key: "5", sub: "JKL" },
    { key: "6", sub: "MNO" },
  ],
  [
    { key: "7", sub: "PQRS" },
    { key: "8", sub: "TUV" },
    { key: "9", sub: "WXYZ" },
  ],
  [{ key: "*" }, { key: "0", sub: "+" }, { key: "#" }],
];

function sanitizeInput(text: string): string {
  return (text || "").replace(/[^\d*#]/g, "").slice(0, 15);
}

function DialKey({
  label,
  sub,
  size,
  onPress,
}: {
  label: string;
  sub?: string;
  size: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dialKey,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.dialKeyPressed,
      ]}
    >
      <Text style={[styles.dialKeyDigit, sub ? styles.dialKeyDigitWithSub : null]}>{label}</Text>
      {sub ? <Text style={styles.dialKeySub}>{sub}</Text> : null}
    </Pressable>
  );
}

export default function DialerScreen() {
  const navigation = useRootNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isOnBreak } = useAgentStatus();
  const [digits, setDigits] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [showName, setShowName] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<TextInput>(null);

  const horizontalPad = 28;
  const keyGap = width < 380 ? 14 : 18;
  const keySize = useMemo(() => {
    const available = width - horizontalPad * 2 - keyGap * 2;
    const computed = Math.floor(available / 3);
    return Math.min(80, Math.max(64, computed));
  }, [width, keyGap]);

  const haptic = useCallback((style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(style).catch(() => undefined);
    }
  }, []);

  const onKey = useCallback(
    (key: string | "back") => {
      haptic();
      if (error) setError("");
      if (key === "back") {
        setDigits((prev) => prev.slice(0, -1));
        return;
      }
      setDigits((prev) => sanitizeInput(prev + key));
    },
    [error, haptic]
  );

  const onClearAll = useCallback(() => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setDigits("");
    setError("");
  }, [haptic]);

  const onInputChange = useCallback((text: string) => {
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
      haptic(Haptics.ImpactFeedbackStyle.Medium);
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
        verification_context: {
          handler: "human",
        },
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
  const hasDigits = digits.length > 0;
  const displayFontSize = display.length > 14 ? 28 : display.length > 10 ? 32 : 38;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {isOnBreak ? (
        <View style={styles.breakBanner}>
          <Feather name="pause-circle" size={14} color={D.bannerText} />
          <Text style={styles.breakBannerText}>On break — end break to dial</Text>
        </View>
      ) : null}

      {/* Number display — centered like native Phone app */}
      <View style={styles.displayZone}>
        <View style={styles.displayRow}>
          <View style={styles.displaySide} />
          <Pressable onPress={() => inputRef.current?.focus()} style={styles.displayPress}>
            <TextInput
              ref={inputRef}
              style={[styles.displayInput, { fontSize: displayFontSize }]}
              value={display}
              onChangeText={onInputChange}
              placeholder="Enter number"
              placeholderTextColor={D.placeholder}
              keyboardType="phone-pad"
              showSoftInputOnFocus={false}
              selectTextOnFocus
              numberOfLines={1}
              allowFontScaling={false}
              autoCorrect={false}
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
          </Pressable>
          <View style={styles.displaySide}>
            {hasDigits ? (
              <Pressable
                onPress={() => onKey("back")}
                onLongPress={onClearAll}
                style={styles.deleteBtn}
                accessibilityLabel="Delete digit. Long press to clear all."
              >
                <Ionicons name="backspace-outline" size={26} color={D.digit} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {showName || customerName ? (
          <View style={styles.nameRow}>
            <TextInput
              style={styles.nameInput}
              value={customerName}
              onChangeText={setCustomerName}
              placeholder="Contact name (optional)"
              placeholderTextColor={D.placeholder}
              returnKeyType="done"
            />
          </View>
        ) : (
          <Pressable onPress={() => setShowName(true)} style={styles.addNameBtn}>
            <Text style={styles.addNameText}>add name</Text>
          </Pressable>
        )}
      </View>

      {/* Keypad grid */}
      <View style={[styles.keypad, { paddingHorizontal: horizontalPad, gap: keyGap }]}>
        {KEY_ROWS.map((row, rowIdx) => (
          <View key={`row-${rowIdx}`} style={[styles.keyRow, { gap: keyGap }]}>
            {row.map((entry) => (
              <DialKey
                key={entry.key}
                label={entry.key}
                sub={entry.sub}
                size={keySize}
                onPress={() => onKey(entry.key)}
              />
            ))}
          </View>
        ))}
      </View>

      {/* Green call button */}
      <View style={[styles.callZone, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          onPress={() => void onCall()}
          disabled={!canCall}
          style={({ pressed }) => [
            styles.callOuter,
            !canCall && styles.callOuterDisabled,
            pressed && canCall && styles.callOuterPressed,
          ]}
        >
          <LinearGradient
            colors={canCall ? [D.call, D.callPressed] : [D.callDisabled, D.callDisabled]}
            style={styles.callBtn}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name="phone" size={32} color="#fff" />
            )}
          </LinearGradient>
        </Pressable>
      </View>

      {Platform.OS !== "web" ? (
        <Text style={styles.devFoot}>EAS dev build required for live agent audio</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: D.bg,
  },
  breakBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: D.banner,
  },
  breakBannerText: {
    fontSize: 13,
    fontWeight: "600",
    color: D.bannerText,
  },
  displayZone: {
    flex: 1,
    minHeight: 120,
    maxHeight: 200,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  displayRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 360,
  },
  displaySide: {
    width: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  displayPress: {
    flex: 1,
    alignItems: "center",
  },
  displayInput: {
    width: "100%",
    textAlign: "center",
    fontWeight: "300",
    color: D.digit,
    letterSpacing: 1.2,
    paddingVertical: 4,
  },
  deleteBtn: {
    padding: 8,
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    color: D.error,
    fontWeight: "500",
    textAlign: "center",
  },
  addNameBtn: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  addNameText: {
    fontSize: 15,
    color: "#007AFF",
    fontWeight: "400",
  },
  nameRow: {
    marginTop: 8,
    width: "100%",
    maxWidth: 280,
  },
  nameInput: {
    fontSize: 15,
    color: D.digit,
    textAlign: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#C7C7CC",
  },
  keypad: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 400,
    paddingBottom: 8,
  },
  keyRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 2,
  },
  dialKey: {
    backgroundColor: D.key,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: D.keyBorder,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  dialKeyPressed: {
    backgroundColor: D.keyPressed,
    transform: [{ scale: 0.96 }],
  },
  dialKeyDigit: {
    fontSize: 32,
    fontWeight: "300",
    color: D.digit,
    lineHeight: 36,
  },
  dialKeyDigitWithSub: {
    marginTop: 2,
    lineHeight: 32,
  },
  dialKeySub: {
    marginTop: -2,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 2,
    color: D.letters,
  },
  callZone: {
    alignItems: "center",
    paddingTop: 4,
  },
  callOuter: {
    borderRadius: 40,
    ...Platform.select({
      ios: {
        shadowColor: D.call,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  callOuterDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  callOuterPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.96 }],
  },
  callBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  devFoot: {
    textAlign: "center",
    fontSize: 10,
    color: D.letters,
    paddingBottom: 4,
    paddingHorizontal: 24,
  },
});
