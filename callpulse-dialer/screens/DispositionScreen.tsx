import React, { useCallback, useEffect, useState } from "react";
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
import {
  AuthError,
  getDispositionCatalog,
  getToken,
  saveCallDisposition,
} from "../services/api";
import { theme } from "../theme";
import type { DispositionCatalogItem } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Disposition">;

export default function DispositionScreen({ route, navigation }: Props) {
  const { callId, lead, returnTo, processId, processName } = route.params;
  const [catalog, setCatalog] = useState<DispositionCatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadCatalog = useCallback(async () => {
    try {
      setLoadingCatalog(true);
      const token = await getToken();
      if (!token) {
        navigation.replace("Login");
        return;
      }
      const items = await getDispositionCatalog(token);
      const active = items.filter((d) => d.active !== false);
      setCatalog(active);
      if (active.length > 0 && !selectedId) {
        setSelectedId(active[0].id);
      }
    } catch (e) {
      if (e instanceof AuthError) {
        navigation.replace("Login");
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load dispositions");
    } finally {
      setLoadingCatalog(false);
    }
  }, [navigation, selectedId]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const navigateAfterSave = () => {
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
              screen: "Campaigns",
              params: {
                screen: "Leads",
                params: { processId: processId ?? "", processName: processName ?? "" },
              },
            },
          },
        ],
      });
    }
  };

  const onSave = async () => {
    if (!callId) {
      setError("No active call to save disposition for");
      return;
    }
    if (!selectedId) {
      setError("Pick an outcome");
      return;
    }
    try {
      setSaving(true);
      setError("");
      const token = await getToken();
      if (!token) {
        navigation.replace("Login");
        return;
      }
      await saveCallDisposition(token, callId, {
        disposition_id: selectedId,
        notes: notes.trim() || null,
      });
      navigateAfterSave();
    } catch (e) {
      if (e instanceof AuthError) {
        navigation.replace("Login");
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to save disposition");
    } finally {
      setSaving(false);
    }
  };

  const onSkip = () => {
    navigateAfterSave();
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
          <Text style={styles.title}>Call Summary</Text>
          <Text style={styles.subtitle}>Set outcome for this lead</Text>

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

          <Text style={styles.sectionLabel}>Outcome</Text>
          {loadingCatalog ? (
            <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: theme.spacing.lg }} />
          ) : catalog.length === 0 ? (
            <Text style={styles.empty}>
              No dispositions configured. Skip to continue.
            </Text>
          ) : (
            <View style={styles.pillsWrap}>
              {catalog.map((item) => {
                const selected = item.id === selectedId;
                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.85}
                    onPress={() => setSelectedId(item.id)}
                    style={[styles.pill, selected ? styles.pillSelected : styles.pillUnselected]}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        selected ? styles.pillTextSelected : styles.pillTextUnselected,
                      ]}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

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

          {catalog.length === 0 ? (
            <TouchableOpacity activeOpacity={0.85} onPress={onSkip} style={styles.skipBtn}>
              <Text style={styles.skipText}>Skip & continue</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={onSave} disabled={saving}>
              <LinearGradient
                colors={theme.colors.primaryGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.saveBtn}
              >
                {saving ? (
                  <ActivityIndicator color={theme.colors.card} />
                ) : (
                  <Text style={styles.saveText}>{returnTo === "dial" ? "Save & Done" : "Save & Next Lead"}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          )}
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
  pillSelected: { backgroundColor: theme.colors.primary },
  pillUnselected: { backgroundColor: theme.colors.muted },
  pillText: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
  pillTextSelected: { color: theme.colors.card },
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
  empty: {
    color: theme.colors.textTertiary,
    fontSize: theme.fontSize.sm,
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
  skipBtn: {
    borderRadius: theme.radius.full,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.muted,
  },
  skipText: {
    color: theme.colors.textPrimary,
    fontWeight: theme.fontWeight.semibold,
  },
});
