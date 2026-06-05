import { Audio } from "expo-av";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { theme } from "../theme";

type Props = {
  audioUrl?: string | null;
};

export function CallRecordingSection({ audioUrl }: Props) {
  const url = audioUrl?.trim() || "";
  const soundRef = useRef<Audio.Sound | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  const unload = useCallback(async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {
        /* ignore */
      }
      soundRef.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => {
    void unload();
    setError("");
  }, [url, unload]);

  useEffect(() => {
    return () => {
      void unload();
    };
  }, [unload]);

  const togglePlay = async () => {
    if (!url) return;
    try {
      setError("");
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }
      if (soundRef.current) {
        await soundRef.current.playAsync();
        setPlaying(true);
        return;
      }
      setLoading(true);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) return;
          setPlaying(status.isPlaying);
          if (status.didJustFinish) {
            setPlaying(false);
          }
        }
      );
      soundRef.current = sound;
      setPlaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not play recording");
      setPlaying(false);
      await unload();
    } finally {
      setLoading(false);
    }
  };

  const openUrl = () => {
    if (!url) return;
    Linking.openURL(url).catch(() => setError("Could not open recording URL"));
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Feather name="headphones" size={18} color={theme.colors.primary} />
        <Text style={styles.sectionTitle}>Call recording</Text>
      </View>

      {!url ? (
        <Text style={styles.muted}>Recording is not available for this call.</Text>
      ) : (
        <>
          <Text style={styles.hint}>Play the stored recording or open the URL in your browser.</Text>

          <View style={styles.controls}>
            <Pressable
              onPress={() => void togglePlay()}
              disabled={loading}
              style={({ pressed }) => [styles.playBtn, pressed && styles.playBtnPressed]}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Feather name={playing ? "pause" : "play"} size={22} color="#fff" />
              )}
            </Pressable>
            <Pressable onPress={openUrl} style={({ pressed }) => [styles.openBtn, pressed && styles.openBtnPressed]}>
              <Feather name="external-link" size={16} color={theme.colors.primary} />
              <Text style={styles.openBtnText}>Open URL</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.urlLabel}>Stored URL</Text>
          <Text style={styles.urlText} selectable>
            {url}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginTop: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    lineHeight: 20,
    marginBottom: theme.spacing.md,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
    lineHeight: 20,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  playBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.button,
  },
  playBtnPressed: { opacity: 0.88 },
  openBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  openBtnPressed: { opacity: 0.85 },
  openBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    marginBottom: theme.spacing.sm,
  },
  urlLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.wide,
    marginBottom: theme.spacing.xs,
  },
  urlText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
});
