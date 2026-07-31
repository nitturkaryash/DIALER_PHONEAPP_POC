import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { formatTime, type ChatMessage } from "../services/chatData";
import {
  fetchUltraChatHistory,
  markUltraChatRead,
  mergeChatMessages,
  messageFromStreamPayload,
  normalizeWhatsAppPhone,
  phoneFromStreamPayload,
  sendUltraChatText,
  subscribeUltraChatStream,
} from "../services/ultrachatChatApi";
import type { RootStackParamList } from "../navigation/types";
import { theme } from "../theme";

const chat = theme.colors.chat;

type Props = NativeStackScreenProps<RootStackParamList, "ChatDetail">;

function Bubble({ msg }: { msg: ChatMessage }) {
  const isOut = msg.fromMe;
  return (
    <View style={[styles.bubbleWrap, isOut ? styles.bubbleWrapOut : styles.bubbleWrapIn]}>
      <View style={[styles.bubble, isOut ? styles.bubbleOut : styles.bubbleIn]}>
        <Text style={styles.bubbleText}>{msg.text}</Text>
        <View style={styles.bubbleMeta}>
          <Text style={styles.bubbleTime}>{formatTime(msg.timestamp)}</Text>
          {isOut && (
            <Ionicons
              name={
                msg.status === "read"
                  ? "checkmark-done"
                  : msg.status === "delivered"
                  ? "checkmark-done-outline"
                  : "checkmark-outline"
              }
              size={14}
              color={msg.status === "read" ? "#53BDEB" : theme.colors.textSecondary}
            />
          )}
        </View>
      </View>
    </View>
  );
}

export default function ChatDetailScreen({ route, navigation }: Props) {
  const { contactId, contactName, contactPhone, contactInitials, contactOnline } = route.params;
  const insets = useSafeAreaInsets();
  const flatRef = useRef<FlatList>(null);
  const sendingRef = useRef(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  const loadHistory = useCallback(
    async (opts?: { silent?: boolean; scrollEnd?: boolean; merge?: boolean }) => {
      const silent = opts?.silent ?? false;
      const scrollEnd = opts?.scrollEnd ?? !silent;
      const merge = opts?.merge ?? false;
      try {
        if (!silent) setLoading(true);
        setError("");
        const history = await fetchUltraChatHistory(contactId);
        let shouldScroll = scrollEnd;
        setMessages((prev) => {
          const next = merge ? mergeChatMessages(prev, history) : history;
          const prevLast = prev[prev.length - 1]?.id;
          const nextLast = next[next.length - 1]?.id;
          if (merge && prevLast === nextLast && prev.length === next.length) {
            shouldScroll = false;
            return prev;
          }
          return next;
        });
        await markUltraChatRead(contactId);
        if (shouldScroll) {
          setTimeout(() => flatRef.current?.scrollToEnd({ animated: merge }), 100);
        }
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : "Failed to load messages");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [contactId]
  );

  useEffect(() => {
    void loadHistory({ silent: false, scrollEnd: true });
  }, [loadHistory]);

  useEffect(() => {
    const sub = subscribeUltraChatStream({
      onEvent: (_name, payload) => {
        const phone = phoneFromStreamPayload(payload);
        if (!phone || normalizeWhatsAppPhone(phone) !== normalizeWhatsAppPhone(contactId)) return;
        const msg = messageFromStreamPayload(payload);
        if (!msg) {
          void loadHistory({ silent: true, scrollEnd: true });
          return;
        }
        setMessages((prev) => mergeChatMessages(prev, [msg]));
        void markUltraChatRead(contactId);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
      },
      onError: () => {
        void loadHistory({ silent: true, scrollEnd: false });
      },
    });

    return () => sub.close();
  }, [contactId, loadHistory]);

  useFocusEffect(
    useCallback(() => {
      const poll = setInterval(() => {
        void loadHistory({ silent: true, scrollEnd: true, merge: true });
      }, 4000);
      return () => clearInterval(poll);
    }, [loadHistory])
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sendingRef.current) return;
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      text,
      fromMe: true,
      timestamp: new Date().toISOString(),
      status: "sent",
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    sendingRef.current = true;
    setSending(true);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      await sendUltraChatText(contactId, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [contactId, input]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </Pressable>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{contactInitials}</Text>
          {contactOnline && <View style={styles.headerOnlineDot} />}
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>
            {contactName}
          </Text>
          <Text style={styles.headerSub}>{contactOnline ? "Online" : contactPhone}</Text>
        </View>
        <Pressable
          onPress={() => void loadHistory({ silent: true, scrollEnd: true })}
          style={styles.headerActions}
        >
          <Feather name="refresh-cw" size={20} color="#fff" />
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Feather name="alert-circle" size={14} color={theme.colors.error} />
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={chat.header} />
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={styles.messageList}
          contentContainerStyle={styles.messageContent}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          onLayout={() => flatRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => <Bubble msg={item} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyHint}>No messages yet — say hello</Text>
            </View>
          }
        />
      )}

      <View style={[styles.inputWrap, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Type a message"
            placeholderTextColor={theme.colors.textTertiary}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={1000}
            editable={!sending}
            onSubmitEditing={() => void send()}
            blurOnSubmit={false}
            returnKeyType={Platform.OS === "web" ? "default" : "send"}
          />
        </View>
        <Pressable
          onPress={() => void send()}
          disabled={sending || !input.trim()}
          style={({ pressed }) => [
            styles.sendBtn,
            (!input.trim() || sending) && styles.sendBtnDisabled,
            pressed && styles.sendBtnPressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Feather name="send" size={20} color="#fff" />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chat.wallpaper },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyHint: { fontSize: theme.fontSize.base, color: theme.colors.textSecondary, textAlign: "center" },
  header: {
    backgroundColor: chat.header,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.bold, color: "#fff" },
  headerOnlineDot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: chat.online,
    borderWidth: 2,
    borderColor: chat.header,
  },
  headerInfo: { flex: 1, minWidth: 0 },
  headerName: { fontSize: theme.fontSize.md, fontWeight: theme.fontWeight.bold, color: "#fff" },
  headerSub: { fontSize: theme.fontSize.sm, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  headerActions: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.errorSoft,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  errorBannerText: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.error },
  messageList: { flex: 1 },
  messageContent: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.lg, gap: 6 },
  bubbleWrap: { flexDirection: "row", marginVertical: 2 },
  bubbleWrapOut: { justifyContent: "flex-end" },
  bubbleWrapIn: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "78%",
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    ...theme.shadow.card,
  },
  bubbleOut: {
    backgroundColor: chat.bubbleOut,
    borderBottomRightRadius: theme.radius.sm,
  },
  bubbleIn: {
    backgroundColor: chat.bubbleIn,
    borderBottomLeftRadius: theme.radius.sm,
  },
  bubbleText: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.textPrimary,
  },
  bubbleMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    marginTop: 4,
  },
  bubbleTime: { fontSize: theme.fontSize.xs, color: theme.colors.textTertiary },
  tick: { fontSize: theme.fontSize.sm, color: theme.colors.textTertiary },
  tickRead: { color: theme.colors.primary },
  inputWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    backgroundColor: theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  inputBar: {
    flex: 1,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: Platform.OS === "web" ? 10 : 8,
    minHeight: 44,
    justifyContent: "center",
  },
  input: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textPrimary,
    maxHeight: 100,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: chat.header,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.button,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnPressed: { opacity: 0.85 },
});
