import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
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

const KEYPAD: Array<string | "back" | "clear"> = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "*",
  "0",
  "#",
  "back",
];

export default function DialerScreen() {
  const navigation = useRootNavigation();
  const [digits, setDigits] = useState("");
  const [customerName, setCustomerName] = useState("Manual Dial");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const bumpLayout = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const onKey = useCallback((key: string | "back" | "clear") => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    bumpLayout();
    if (key === "back") {
      setDigits((prev) => prev.slice(0, -1));
      return;
    }
    if (key === "clear") {
      setDigits("");
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
      <View style={styles.container}>
        <Text style={styles.title}>Dial</Text>
        <Text style={styles.subtitle}>Enter a number for a live agent call (your microphone)</Text>

        <View style={styles.displayCard}>
          <Text style={styles.display}>{display || " "}</Text>
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
          {KEYPAD.map((key) => {
            const label = key === "back" ? "⌫" : key === "clear" ? "C" : key;
            return (
              <TouchableOpacity
                key={String(key)}
                activeOpacity={0.85}
                style={styles.key}
                onPress={() => onKey(key)}
                onLongPress={key === "back" ? () => onKey("clear") : undefined}
              >
                <Text style={styles.keyText}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity activeOpacity={0.85} onPress={onCall} disabled={!canCall} style={!canCall ? styles.callDisabled : undefined}>
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
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
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
    width: "30%",
    aspectRatio: 1.35,
    maxHeight: 56,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.card,
  },
  keyText: {
    fontSize: theme.fontSize.lg,
    fontWeight: "500",
    color: theme.colors.textPrimary,
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
