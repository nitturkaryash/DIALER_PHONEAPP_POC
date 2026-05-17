import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation/types";
import { AuthError, clearToken, getToken, saveDisposition, saveHumanAgentDisposition } from "../services/api";
import { theme } from "../theme";
import type { Disposition } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Disposition">;

const outcomes: Disposition[] = ["Connected", "No Answer", "Busy", "Call Later", "Invalid"];

export default function DispositionScreen({ route, navigation }: Props) {
  const { callId, lead, returnTo, processId, processName, callMode } = route.params;
  const [outcome, setOutcome] = useState<Disposition>("Connected");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSave = async () => {
    try {
      setLoading(true);
      setError("");
      const token = await getToken();
      if (!token) {
        navigation.replace("Login");
        return;
      }
      const payload = { outcome, notes: notes.trim() || undefined };
      if (callMode === "human") {
        await saveHumanAgentDisposition(token, callId, payload);
      } else {
        await saveDisposition(token, callId, payload);
      }
      if (returnTo === "dial") {
        navigation.reset({
          index: 0,
          routes: [{ name: "MainTabs", params: { screen: "Dial" } }],
        });
      } else {
        navigation.reset({
          index: 0,
          routes: [
            {
              name: "MainTabs",
              params: {
                screen: "CampaignList",
                params: {
                  screen: "Leads",
                  params: { processId: processId ?? "", processName: processName ?? "" },
                },
              },
            },
          ],
        });
      }
    } catch (e) {
      if (e instanceof AuthError) {
        await clearToken();
        navigation.replace("Login");
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to save disposition");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={theme.colors.backgroundGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.kavWrapper}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <Text style={styles.title}>Call Summary</Text>
          <Text style={styles.subtitle}>Set outcome for this lead</Text>

          {/* Contact card */}
          <View style={styles.contactCard}>
            <View style={styles.contactInitials}>
              <Text style={styles.contactInitialsText}>
                {lead.name
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase())
                  .join("")}
              </Text>
            </View>
            <View>
              <Text style={styles.contactName}>{lead.name}</Text>
              <Text style={styles.contactPhone}>{lead.phone}</Text>
            </View>
          </View>

          {/* Outcome pills */}
          <Text style={styles.sectionLabel}>Outcome</Text>
          <View style={styles.pillsWrap}>
            {outcomes.map((item) => {
              const selected = item === outcome;
              return (
                <TouchableOpacity
                  key={item}
                  activeOpacity={0.85}
                  onPress={() => setOutcome(item)}
                  style={[styles.pill, selected ? styles.pillSelected : styles.pillUnselected]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      selected ? styles.pillTextSelected : styles.pillTextUnselected,
                    ]}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Notes */}
          <Text style={styles.sectionLabel}>Notes</Text>
          <TextInput
            style={styles.notes}
            multiline
            numberOfLines={4}
            placeholder="Add notes about this call..."
            placeholderTextColor={theme.colors.textTertiary}
            value={notes}
            onChangeText={setNotes}
            textAlignVertical="top"
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          {/* Save button */}
          <TouchableOpacity activeOpacity={0.85} onPress={onSave} disabled={loading}>
            <LinearGradient
              colors={theme.colors.primaryGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveBtn}
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.card} />
              ) : (
                <Text style={styles.saveText}>{returnTo === "dial" ? "Save & Done" : "Save & Next Lead"}</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  kavWrapper: { flex: 1 },
  content: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing["3xl"],
  },
  title: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.textPrimary,
    fontWeight: theme.fontWeight.semibold,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xl,
  },
  // contact card with xl radius (24px)
  contactCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginBottom: theme.spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    ...theme.shadow.card,
  },
  contactInitials: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  contactInitialsText: {
    color: theme.colors.card,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
  },
  contactName: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textPrimary,
    fontWeight: theme.fontWeight.semibold,
  },
  contactPhone: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  sectionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  pillsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  pill: {
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  // accent on selected, muted on unselected (consistent with profile accent rule)
  pillSelected: { backgroundColor: theme.colors.accent },
  pillUnselected: { backgroundColor: theme.colors.muted },
  pillText: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
  pillTextSelected: { color: theme.colors.textPrimary },
  pillTextUnselected: { color: theme.colors.textSecondary },
  notes: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.base,
    marginBottom: theme.spacing.xl,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing.md,
  },
  saveBtn: {
    borderRadius: theme.radius.full,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    ...theme.shadow.button,
  },
  saveText: {
    color: theme.colors.card,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
});
