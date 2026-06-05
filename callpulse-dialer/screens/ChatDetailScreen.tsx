import React, { useCallback, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { mockChats, formatTime, type ChatMessage } from "../services/chatData";
import type { RootStackParamList } from "../navigation/types";
import { theme } from "../theme";

const QUICK_TEMPLATES = [
  { id: "t1", label: "Policy Renewal", text: "Hi, your policy is up for renewal soon. Would you like to renew it today? I can walk you through the process." },
  { id: "t2", label: "Intro Call", text: "Hi, this is your advisor from CallPulse. Is this a good time to talk about your insurance coverage?" },
  { id: "t3", label: "Claim Status", text: "Your claim is currently under review. You will receive an update within 48 hours. Thank you for your patience." },
  { id: "t4", label: "Thank You", text: "Thank you for your time today. We will follow up with the details shortly." },
  { id: "t5", label: "Schedule Call", text: "I would like to schedule a call to discuss your policy in detail. What time works best for you?" },
];

const MOCK_LEAD_CONTEXT = {
  stage: "Hot Lead",
  stageColor: "#22C55E",
  lastCall: "Yesterday · 4m 32s · Interested",
  nextAction: "Follow up by Fri 30 May",
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

  const contact = mockChats.find((c) => c.id === contactId);
  const [messages, setMessages] = useState<ChatMessage[]>(contact?.messages ?? []);
  const [input, setInput] = useState("");

  const [showTemplates, setShowTemplates] = useState(false);
  const templateAnim = useRef(new Animated.Value(0)).current;

  const [showLeadPanel, setShowLeadPanel] = useState(false);
  const leadPanelHeight = useRef(new Animated.Value(0)).current;

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

  const toggleTemplates = () => {
    const toValue = showTemplates ? 0 : 1;
    setShowTemplates(!showTemplates);
    Animated.timing(templateAnim, {
      toValue,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  const applyTemplate = (text: string) => {
    setInput(text);
    setShowTemplates(false);
    Animated.timing(templateAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  const toggleLeadPanel = () => {
    const toValue = showLeadPanel ? 0 : 72;
    setShowLeadPanel(!showLeadPanel);
    Animated.timing(leadPanelHeight, {
      toValue,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
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
          <Ionicons name="call-outline" size={22} color="#FFFFFF" />
        </View>
        <Pressable onPress={toggleLeadPanel} style={styles.leadToggleBtn}>
          <Ionicons
            name={showLeadPanel ? "chevron-up" : "chevron-down"}
            size={18}
            color="#FFFFFF"
          />
        </Pressable>
      </View>

      {/* Lead context panel */}
      <Animated.View style={[styles.leadPanel, { height: leadPanelHeight }]}>
        <View style={styles.leadPanelInner}>
          <View style={[styles.leadStageBadge, { backgroundColor: MOCK_LEAD_CONTEXT.stageColor + "22" }]}>
            <Text style={[styles.leadStageText, { color: MOCK_LEAD_CONTEXT.stageColor }]}>
              {MOCK_LEAD_CONTEXT.stage}
            </Text>
          </View>
          <View style={styles.leadMeta}>
            <Text style={styles.leadMetaLabel}>Last call</Text>
            <Text style={styles.leadMetaValue}>{MOCK_LEAD_CONTEXT.lastCall}</Text>
          </View>
          <View style={styles.leadMeta}>
            <Text style={styles.leadMetaLabel}>Next</Text>
            <Text style={styles.leadMetaValue}>{MOCK_LEAD_CONTEXT.nextAction}</Text>
          </View>
        </View>
      </Animated.View>

      {/* Messages + Input bar */}
      <View style={{ flex: 1 }}>
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={styles.messageList}
          contentContainerStyle={styles.messageContent}
          onLayout={() => flatRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => <Bubble msg={item} />}
        />

        {/* Quick reply template picker */}
        {showTemplates && (
          <Animated.View
            style={[
              styles.templateRow,
              {
                opacity: templateAnim,
                transform: [
                  {
                    translateY: templateAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [20, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.templateScroll}
            >
              {QUICK_TEMPLATES.map((t) => (
                <Pressable
                  key={t.id}
                  style={({ pressed }) => [styles.templatePill, pressed && styles.templatePillPressed]}
                  onPress={() => applyTemplate(t.text)}
                >
                  <Text style={styles.templatePillText}>{t.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Input bar */}
        <View style={[styles.inputWrap, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.inputBar}>
            <Pressable onPress={toggleTemplates} style={styles.templateBtn}>
              <Ionicons
                name={showTemplates ? "flash" : "flash-outline"}
                size={20}
                color={showTemplates ? theme.colors.primary : theme.colors.textSecondary}
              />
            </Pressable>
            <TextInput
              style={styles.input}
              placeholder="Message"
              placeholderTextColor={theme.colors.textSecondary}
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
            {input.trim()
              ? <Ionicons name="send" size={18} color="#FFFFFF" />
              : <Ionicons name="mic-outline" size={20} color="#FFFFFF" />
            }
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },

  header: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backBtn: { padding: 4 },

  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  headerOnlineDot: {
    position: "absolute",
    right: 1,
    bottom: 1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: theme.colors.success,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },

  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 1 },

  headerActions: { flexDirection: "row", gap: 8 },

  leadToggleBtn: {
    padding: 4,
  },

  leadPanel: {
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  leadPanelInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
  },
  leadStageBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  leadStageText: {
    fontSize: 12,
    fontWeight: "700",
  },
  leadMeta: {
    flexDirection: "column",
    gap: 1,
  },
  leadMetaLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  leadMetaValue: {
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.textPrimary,
  },

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
    backgroundColor: "rgba(27, 77, 140, 0.15)",
    borderTopRightRadius: 4,
  },
  bubbleIn: {
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOut: { color: theme.colors.textPrimary },
  bubbleTextIn: { color: theme.colors.textPrimary },

  bubbleMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 4 },
  bubbleTime: { fontSize: 11, color: theme.colors.textSecondary },

  templateRow: {
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: 10,
  },
  templateScroll: {
    paddingHorizontal: 12,
    gap: 8,
    flexDirection: "row",
  },
  templatePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: "#FFFFFF",
  },
  templatePillPressed: {
    opacity: 0.65,
  },
  templatePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primary,
  },

  inputWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: theme.colors.surfaceMuted,
    gap: 8,
  },
  inputBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.card,
    borderRadius: 24,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === "web" ? 10 : 8,
    minHeight: 44,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  templateBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
    maxHeight: 100,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  sendBtnPressed: { opacity: 0.8 },
});
