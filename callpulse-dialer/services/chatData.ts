export type ChatMessage = {
  id: string;
  text: string;
  fromMe: boolean;
  timestamp: string; // ISO
  status?: "sent" | "delivered" | "read";
};

export type ChatContact = {
  id: string;
  name: string;
  phone: string;
  initials: string;
  lastMessage: string;
  lastMessageTime: string;
  unread: number;
  online: boolean;
  messages: ChatMessage[];
};

function ts(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function fmt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

export function formatTime(iso: string): string {
  return fmt(iso);
}

export const mockChats: ChatContact[] = [
  {
    id: "c1",
    name: "Sarah Johnson",
    phone: "+1 (555) 204-3311",
    initials: "SJ",
    lastMessage: "Yes, I'm interested in the renewal plan.",
    lastMessageTime: ts(5),
    unread: 2,
    online: true,
    messages: [
      { id: "m1", text: "Hi Sarah, this is Alex from CallPulse. How are you?", fromMe: true, timestamp: ts(35), status: "read" },
      { id: "m2", text: "Hi! I'm doing well, thanks for reaching out.", fromMe: false, timestamp: ts(33) },
      { id: "m3", text: "I wanted to follow up on the renewal offer we discussed last week.", fromMe: true, timestamp: ts(30), status: "read" },
      { id: "m4", text: "Oh yes, I had a few questions about the pricing.", fromMe: false, timestamp: ts(28) },
      { id: "m5", text: "Of course! Our current plan starts at $49/month with a 20% discount for renewals.", fromMe: true, timestamp: ts(25), status: "read" },
      { id: "m6", text: "That sounds reasonable. What does the plan include?", fromMe: false, timestamp: ts(20) },
      { id: "m7", text: "It includes unlimited calls, CRM integration, and priority support.", fromMe: true, timestamp: ts(18), status: "read" },
      { id: "m8", text: "Yes, I'm interested in the renewal plan.", fromMe: false, timestamp: ts(5) },
    ],
  },
  {
    id: "c2",
    name: "Michael Torres",
    phone: "+1 (555) 871-0092",
    initials: "MT",
    lastMessage: "Could you send me the brochure?",
    lastMessageTime: ts(42),
    unread: 0,
    online: false,
    messages: [
      { id: "m1", text: "Hello Michael, following up on your inquiry.", fromMe: true, timestamp: ts(120), status: "read" },
      { id: "m2", text: "Hey, yes I was looking at your enterprise package.", fromMe: false, timestamp: ts(115) },
      { id: "m3", text: "Great! I can walk you through it. Do you have 15 minutes?", fromMe: true, timestamp: ts(110), status: "read" },
      { id: "m4", text: "Not right now, a bit tied up.", fromMe: false, timestamp: ts(100) },
      { id: "m5", text: "No worries at all. Could you send me the brochure?", fromMe: false, timestamp: ts(42) },
    ],
  },
  {
    id: "c3",
    name: "Emily Chen",
    phone: "+1 (555) 439-7761",
    initials: "EC",
    lastMessage: "Perfect, talk tomorrow then! 👋",
    lastMessageTime: ts(180),
    unread: 0,
    online: true,
    messages: [
      { id: "m1", text: "Emily, just confirming our call tomorrow at 10am.", fromMe: true, timestamp: ts(200), status: "read" },
      { id: "m2", text: "Yes confirmed! I'll have the team on the call too.", fromMe: false, timestamp: ts(190) },
      { id: "m3", text: "Fantastic. I'll send a calendar invite shortly.", fromMe: true, timestamp: ts(185), status: "delivered" },
      { id: "m4", text: "Perfect, talk tomorrow then! 👋", fromMe: false, timestamp: ts(180) },
    ],
  },
  {
    id: "c4",
    name: "David Patel",
    phone: "+1 (555) 654-2200",
    initials: "DP",
    lastMessage: "Let me check with my manager and get back to you.",
    lastMessageTime: ts(60 * 24),
    unread: 1,
    online: false,
    messages: [
      { id: "m1", text: "Hi David, hope you're doing well!", fromMe: true, timestamp: ts(60 * 25), status: "read" },
      { id: "m2", text: "Doing good! What's up?", fromMe: false, timestamp: ts(60 * 24 + 50) },
      { id: "m3", text: "We have a special offer for your account this month.", fromMe: true, timestamp: ts(60 * 24 + 30), status: "read" },
      { id: "m4", text: "Let me check with my manager and get back to you.", fromMe: false, timestamp: ts(60 * 24) },
    ],
  },
  {
    id: "c5",
    name: "Rachel Kim",
    phone: "+1 (555) 321-9045",
    initials: "RK",
    lastMessage: "Thanks for the quick response! 🙏",
    lastMessageTime: ts(60 * 48),
    unread: 0,
    online: false,
    messages: [
      { id: "m1", text: "Hi Rachel, your support ticket has been resolved.", fromMe: true, timestamp: ts(60 * 49), status: "read" },
      { id: "m2", text: "Oh that was fast! What was the issue?", fromMe: false, timestamp: ts(60 * 48 + 30) },
      { id: "m3", text: "A configuration issue on our end — all fixed now.", fromMe: true, timestamp: ts(60 * 48 + 10), status: "read" },
      { id: "m4", text: "Thanks for the quick response! 🙏", fromMe: false, timestamp: ts(60 * 48) },
    ],
  },
];
