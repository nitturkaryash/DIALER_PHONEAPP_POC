import React, { useCallback, useRef, useState } from "react";
import {
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
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { mockChats, formatTime, type ChatMessage } from "../services/chatData";
import type { RootStackParamList } from "../navigation/types";

const C = {
  header: "#075E54",
  headerText: "#FFFFFF",
  chatBg: "#ECE5DD",
  outBubble: "#DCF8C6",
  inBubble: "#FFFFFF",
  outText: "#111B21",
  inText: "#111B21",
  metaText: "#667781",
  inputBg: "#F0F2F0",
  sendBtn: "#075E54",
  sendBtnText: "#FFFFFF",
  online: "#25D366",
  statusRead: "#53BDEB",
};

type Props = NativeStackScreenProps<RootStackParamList, "ChatDetail">;

function Bubble({ msg }: { msg: ChatMessage }) {
  const isOut = msg.fromMe;
  return (
    <View style={[styles.bubbleWrap, isOut ? styles.bubbleWrapOut : styles.bubbleWrapIn]}>
      <View style={[styles.bubble, isOut ? styles.bubbleOut : styles.bubbleIn]}>
        <Text style={[styles.bubbleText, isOut ? styles.bubbleTextOut : styles.bubbleTextIn]}>
          {msg.text}
        </Text>
        <View style={styles.bubbleMeta}>
          <Text style={styles.bubbleTime}>{formatTime(msg.timestamp)}</Text>
          {isOut && (
            <Text style={[styles.tick, msg.status === "read" && styles.tickRead]}>
              {msg.status === "read" ? "✓✓" : msg.status === "delivered" ? "✓✓" : "✓"}
            </Text>
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

  const contact = mockChats.find((c) => c.id === contactId);
  const [messages, setMessages] = useState<ChatMessage[]>(contact?.messages ?? []);
  const [input, setInput] = useState("");

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      text,
      fromMe: true,
      timestamp: new Date().toISOString(),
      status: "sent",
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput("");
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
  }, [input]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{contactInitials}</Text>
          {contactOnline && <View style={styles.headerOnlineDot} />}
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{contactName}</Text>
          <Text style={styles.headerSub}>{contactOnline ? "online" : contactPhone}</Text>
        </View>
        <View style={styles.headerActions}>
          <Text style={styles.headerActionIcon}>📞</Text>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(m) => m.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onLayout={() => flatRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => <Bubble msg={item} />}
      />

      {/* Input bar */}
      <View style={[styles.inputWrap, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor={C.metaText}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={1000}
            onSubmitEditing={send}
            blurOnSubmit={false}
            returnKeyType={Platform.OS === "web" ? "default" : "send"}
          />
        </View>
        <Pressable
          onPress={send}
          style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed]}
        >
          <Text style={styles.sendIcon}>{input.trim() ? "▶" : "🎙"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.chatBg },

  header: {
    backgroundColor: C.header,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 22, color: C.headerText },

  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: { fontSize: 15, fontWeight: "700", color: C.headerText },
  headerOnlineDot: {
    position: "absolute",
    right: 1,
    bottom: 1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: C.online,
    borderWidth: 2,
    borderColor: C.header,
  },

  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: "700", color: C.headerText },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 1 },

  headerActions: { flexDirection: "row", gap: 8 },
  headerActionIcon: { fontSize: 20 },

  messageList: { flex: 1 },
  messageContent: { paddingHorizontal: 12, paddingVertical: 16, gap: 4 },

  bubbleWrap: { flexDirection: "row", marginVertical: 2 },
  bubbleWrapOut: { justifyContent: "flex-end" },
  bubbleWrapIn: { justifyContent: "flex-start" },

  bubble: {
    maxWidth: "75%",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleOut: {
    backgroundColor: C.outBubble,
    borderTopRightRadius: 4,
  },
  bubbleIn: {
    backgroundColor: C.inBubble,
    borderTopLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOut: { color: C.outText },
  bubbleTextIn: { color: C.inText },

  bubbleMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 4 },
  bubbleTime: { fontSize: 11, color: C.metaText },
  tick: { fontSize: 12, color: C.metaText },
  tickRead: { color: C.statusRead },

  inputWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: "#F0F2F0",
    gap: 8,
  },
  inputBar: {
    flex: 1,
    backgroundColor: C.inBubble,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "web" ? 10 : 8,
    minHeight: 44,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  input: {
    fontSize: 15,
    color: "#111B21",
    maxHeight: 100,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.sendBtn,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  sendBtnPressed: { opacity: 0.8 },
  sendIcon: { fontSize: 18, color: C.sendBtnText },
});
