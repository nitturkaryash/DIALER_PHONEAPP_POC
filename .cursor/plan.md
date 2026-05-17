# CallPulse Dialer App — Build Plan

> **Scope:** Add a cross-platform React Native (Expo) agent dialer app + new `backend/routes/dialer.py` routes to the existing CallPulse monorepo on the `dev` branch.

---

## 1. Context & What Already Exists

### Monorepo Structure
```
CallPulse/
├── backend/          # FastAPI + Python
│   ├── routes/       # All API route files
│   ├── services/     # Business logic
│   ├── models/       # Pydantic models
│   ├── utils/        # DB client, auth helpers
│   └── api.py        # App entry, router registration
└── frontend/         # Next.js 14 + Tailwind (web dashboard)
    ├── src/app/      # Next.js App Router pages
    ├── src/components/
    └── design.json   # ← SINGLE SOURCE OF TRUTH for all design tokens
```

### Backend Stack (already running)
- **Framework:** FastAPI + Uvicorn + Gunicorn
- **Database:** MongoDB (via `utils/database.py` — uses `leads_collection`, `db`, `dispositions_collection`)
- **Auth:** JWT via PyJWT, `utils/auth_utils.py`, `get_current_user`, `oauth2_scheme`
- **Key existing routes used by dialer:**
  - `POST /auth/login-json` → `{ access_token, token_type }`
  - `GET /auth/me` → `{ id, email, full_name, role }`
  - `POST /v1/webhook/dialer/tcn/{token}` → existing webhook processor
  - `GET /v1/public/leads` → leads collection (MongoDB pattern reference)
  - `GET /v1/processes` → campaigns/process list
  - `routes/dispositions.py` → save dispositions

### Frontend Stack (web dashboard — DO NOT modify)
- Next.js 14, Tailwind CSS, MUI, Tremor, Recharts, Framer Motion
- Design system lives in `frontend/design.json` (Callivio Dashboard v1.0.0)

---

## 2. Design System (from `frontend/design.json`)

All colors, spacing, radius, shadows, and typography come from this file. **Never hardcode values.**

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#6FA3D2` → `#89B9E3` (gradient 135deg) | Primary buttons, active indicators, focus rings |
| Accent / Lime | `#C3E836` | Call button, selected state, highlight bars |
| Background | `#F5F5F7` | All screen backgrounds |
| Card | `#FFFFFF` | All card backgrounds |
| Text Primary | `#1A1A1A` | Headings, values |
| Text Secondary | `#6B7280` | Labels, subtitles |
| Text Tertiary | `#9CA3AF` | Captions, placeholders |
| Success | `#10B981` | Connected status, positive change |
| Error | `#EF4444` | End call button, error states |
| Warning | `#F59E0B` | Warning badges |

### Typography
| Size Token | px | Weight | Usage |
|------------|-----|--------|-------|
| xs | 11px | 400 | Micro labels |
| sm | 12px | 400/500 | Captions, badges |
| base | 14px | 400/500 | Body text, inputs |
| md | 16px | 400/500 | Subtitles |
| lg | 18px | 500/600 | Section headers |
| xl | 24px | 600 | Screen titles |
| 2xl | 32px | 600 | Metric values |

### Spacing: `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px`
### Border Radius: `4 / 8 / 12 / 16 / 24 / 9999px`

### Card Spec
```
background: #FFFFFF
borderRadius: 16px
padding: 24px
shadow: 0 2px 12px rgba(0,0,0,0.06)
hover: shadow 0 4px 20px rgba(0,0,0,0.10) + translateY(-2px)
transition: all 250ms ease
```

### Button Specs
- **Primary:** gradient 135deg `#6FA3D2→#89B9E3`, white text, radius 8px, shadow `rgba(111,163,210,0.3)`
- **Secondary:** white bg, `#6B7280` text, border `#E5E7EB`
- **Lime/Call:** bg `#C3E836`, text `#1A1A1A`, radius 12px
- **Danger/End-Call:** bg `#EF4444`, white text, circle

### Badge Specs
- Success: bg `#F0FDF4`, text `#10B981`, border `#10B98120`
- Error: bg `#FEE2E2`, text `#EF4444`, border `#EF444420`
- Neutral: bg `#F3F4F6`, text `#6B7280`, border `#6B728020`
- Warning: bg `#FEF3C7`, text `#F59E0B`, border `#F59E0B20`

---

## 3. New Backend Routes — `backend/routes/dialer.py`

### What to build
New router with prefix `/v1/dialer`. Follow the exact MongoDB pattern from `routes/leads.py` (use `db`, `ObjectId`, `datetime`, logging pattern).

### Endpoints

```
GET  /v1/dialer/campaigns
     → Auth required (get_current_user)
     → Returns processes for the agent's project_id
     → Response: [{ id, name, status, lead_count }]

GET  /v1/dialer/campaigns/:process_id/leads
     → Query params: status=pending (default), limit=50, skip=0
     → Returns leads for this process filtered by status
     → Response: [{ id, name, phone, status, email? }]

POST /v1/dialer/calls
     → Body: { lead_id, process_id }
     → Creates call_sessions document (see schema below)
     → Updates lead status → "calling"
     → Response: { call_id, lead_name, phone }

PATCH /v1/dialer/calls/:call_id/status
     → Body: { status: "answered" | "ended" }
     → Updates call_sessions.status + answered_at / ended_at + duration_seconds
     → Response: { success }

POST /v1/dialer/calls/:call_id/disposition
     → Body: { outcome, notes, callback_time? }
     → Saves disposition to call_sessions
     → Updates lead status to outcome value
     → Triggers internal webhook (reuse process_dialer_webhook_service if applicable)
     → Response: { success, next_lead_id? }
```

### `call_sessions` MongoDB Document Schema
```json
{
  "_id": "ObjectId",
  "lead_id": "string",
  "process_id": "string",
  "agent_id": "string (from JWT)",
  "project_id": "string",
  "status": "originated | answered | ended",
  "outcome": "Connected | No Answer | Busy | Call Later | Invalid | null",
  "notes": "string | null",
  "callback_time": "datetime | null",
  "created_at": "datetime",
  "answered_at": "datetime | null",
  "ended_at": "datetime | null",
  "duration_seconds": "int | null"
}
```

### Register in `api.py`
```python
from routes.dialer import router as dialer_router
app.include_router(dialer_router)
```

---

## 4. React Native Dialer App — New Repo

### Setup
```bash
# Create new Expo project (separate from the monorepo)
npx create-expo-app callpulse-dialer --template blank-typescript
cd callpulse-dialer

# Install deps
npx expo install expo-secure-store
npx expo install react-native-safe-area-context react-native-screens
npm install @react-navigation/native @react-navigation/native-stack
```

### File Structure
```
callpulse-dialer/
├── App.tsx
├── theme.ts                        ← all design.json tokens as typed const
├── types/
│   └── index.ts                    ← Agent, Campaign, Lead, CallSession, Disposition
├── services/
│   └── api.ts                      ← all fetch() calls to real backend
├── navigation/
│   └── RootNavigator.tsx           ← Stack navigator
└── screens/
    ├── LoginScreen.tsx
    ├── CampaignScreen.tsx
    ├── LeadsScreen.tsx
    ├── CallScreen.tsx
    └── DispositionScreen.tsx
```

### `theme.ts` — Token Map (React Native units)
```typescript
export const theme = {
  colors: {
    primary: '#6FA3D2',
    primaryGradient: ['#6FA3D2', '#89B9E3'],
    accent: '#C3E836',
    bg: '#F5F5F7',
    card: '#FFFFFF',
    muted: '#F3F4F6',
    textPrimary: '#1A1A1A',
    textSecondary: '#6B7280',
    textTertiary: '#9CA3AF',
    success: '#10B981',
    error: '#EF4444',
    warning: '#F59E0B',
    border: '#E5E7EB',
  },
  fontSize: { xs:11, sm:12, base:14, md:16, lg:18, xl:24, '2xl':32 },
  fontWeight: { light:'300', regular:'400', medium:'500', semibold:'600', bold:'700' },
  spacing: { xs:4, sm:8, md:12, lg:16, xl:24, '2xl':32, '3xl':48, '4xl':64 },
  radius: { sm:4, base:8, md:12, lg:16, xl:24, full:9999 },
  shadow: {
    card: { shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.06, shadowRadius:12, elevation:3 },
    button: { shadowColor:'#6FA3D2', shadowOffset:{width:0,height:2}, shadowOpacity:0.3, shadowRadius:8, elevation:4 },
  },
  transition: { fast:150, base:250, slow:350 },
}
```

### `services/api.ts` — Real Endpoints
```typescript
const BASE_URL = 'http://localhost:8000' // update to production URL

// POST /auth/login-json
export const login = (email: string, password: string) => ...

// GET /auth/me
export const getMe = (token: string) => ...

// GET /v1/dialer/campaigns
export const getCampaigns = (token: string) => ...

// GET /v1/dialer/campaigns/:id/leads
export const getLeads = (token: string, processId: string, status = 'pending') => ...

// POST /v1/dialer/calls
export const startCall = (token: string, leadId: string, processId: string) => ...

// PATCH /v1/dialer/calls/:id/status
export const updateCallStatus = (token: string, callId: string, status: string) => ...

// POST /v1/dialer/calls/:id/disposition
export const saveDisposition = (token: string, callId: string, data: DispositionPayload) => ...
```
JWT stored via `expo-secure-store`. On 401 response → clear token → navigate to Login.

### Screen Specs

#### `LoginScreen`
- Full screen `#F5F5F7` bg
- Centered white card (radius 16, shadow card)
- "CallPulse" logo text (24px 600 primary blue)
- Email + Password inputs (height 40, radius 8, border `#E5E7EB`, focus border `#6FA3D2`)
- Primary gradient "Sign In" button (full width, radius 8)
- KeyboardAvoidingView wrapper

#### `CampaignScreen`
- Header: "Select Campaign" (24px 600) + avatar circle with initials from `/auth/me`
- Agent name subtitle (14px secondary) + role badge (neutral badge)
- FlatList 2-column grid of campaign cards
- Each card: campaign name (16px 600), status badge (success=Active / neutral=Paused), lead count pill (lime `#C3E836` bg, 11px 700 dark text)
- Press → navigate to Leads with `{ processId, processName }`

#### `LeadsScreen`
- Header: back `←` + campaign name (18px 600)
- Search bar (height 36, radius 8, bg `#F9FAFB`, border `#E5E7EB`, search icon left)
- FlatList of lead cards. Each card:
  - Left: name (14px 500 primary text), phone (12px tertiary)
  - Status dot (10x10 circle): `#10B981` = Pending, `#EF4444` = others
  - Right: call button (40x40, radius 12, lime bg, `📞` icon 18px dark)
- Live search filters name + phone

#### `CallScreen`
- BG `#F5F5F7`
- Lead name (24px 600), phone + campaign (12px secondary), center avatar circle (140x140, muted bg, initials)
- Timer counting up `00:00` (18px 500 secondary)
- Bottom row: mute (40x40 secondary), call (72x72 circle primary gradient `📞`), end (72x72 circle `#EF4444` white `✕`)
- On end → navigate to Disposition with `{ callId, lead }`

#### `DispositionScreen`
- Title "Call Summary" (20px 600)
- Contact card (name + phone, white card)
- Outcome pill row: Connected / No Answer / Busy / Call Later / Invalid
  - Selected: lime bg `#C3E836`, dark text; Unselected: muted bg `#F3F4F6`, secondary text
- Notes textarea (4 rows, base input style)
- "Save & Next" primary gradient full-width pill button
- On save → POST disposition → navigate back to LeadsScreen
- KeyboardAvoidingView wrapper

### RN Rules (strict)
- `TouchableOpacity activeOpacity={0.85}` on all pressables
- `SafeAreaView` only at root `App.tsx`
- `StyleSheet.create` for static styles only; inline for dynamic (selected state, etc.)
- Font weights as strings: `'600'` not `600`
- `showsVerticalScrollIndicator={false}` on all lists
- No external UI libraries

---

## 5. API Contract Summary

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| POST | `/auth/login-json` | None | `{ email, password }` | `{ access_token }` |
| GET | `/auth/me` | Bearer | — | `{ id, email, full_name, role }` |
| GET | `/v1/dialer/campaigns` | Bearer | — | `Campaign[]` |
| GET | `/v1/dialer/campaigns/:id/leads` | Bearer | — | `Lead[]` |
| POST | `/v1/dialer/calls` | Bearer | `{ lead_id, process_id }` | `{ call_id }` |
| PATCH | `/v1/dialer/calls/:id/status` | Bearer | `{ status }` | `{ success }` |
| POST | `/v1/dialer/calls/:id/disposition` | Bearer | `{ outcome, notes }` | `{ success }` |

---

## 6. Execution Order

```
Phase 1 — Backend (2–3 hrs)
  ✅ Step 1: Create backend/routes/dialer.py
  ✅ Step 2: Register router in api.py
  ✅ Step 3: Test all 5 endpoints with Postman/curl
  ✅ Step 4: Verify MongoDB documents created correctly

Phase 2 — React Native App (4–6 hrs)
  ✅ Step 5: npx create-expo-app callpulse-dialer
  ✅ Step 6: Create theme.ts from design.json tokens
  ✅ Step 7: Create types/index.ts
  ✅ Step 8: Create services/api.ts wired to backend
  ✅ Step 9: Build LoginScreen → test auth flow end-to-end
  ✅ Step 10: Build CampaignScreen → test real data from /v1/dialer/campaigns
  ✅ Step 11: Build LeadsScreen → search + call button
  ✅ Step 12: Build CallScreen → timer + controls
  ✅ Step 13: Build DispositionScreen → save + navigate back

Phase 3 — Polish (1–2 hrs)
  ✅ Step 14: Error states (no network, 401, empty list)
  ✅ Step 15: Loading skeletons on lists
  ✅ Step 16: Test on iOS simulator + Android emulator + Expo Go
  ✅ Step 17: Update BASE_URL to production backend URL
```

---

## 7. Cursor Prompt (paste into Cursor Composer)

```
You are a senior full-stack engineer working on the CallPulse project.
Study these existing files first for patterns:
- backend/routes/leads.py (MongoDB pattern: uses db, ObjectId, datetime, logging)
- backend/routes/auth.py (JWT auth pattern: get_current_user, oauth2_scheme)
- backend/api.py (router registration pattern)
- frontend/design.json (ALL design tokens — use these for every visual value)

## TASK 1: Create backend/routes/dialer.py

New FastAPI router with prefix /v1/dialer. All routes require JWT auth using the same pattern as existing routes.

Endpoints:
GET  /v1/dialer/campaigns
     → get agent's project_id from JWT user → query db.processes for that project
     → return [{ id, name, status, lead_count }]

GET  /v1/dialer/campaigns/{process_id}/leads
     → query params: status: str = "pending", limit: int = 50, skip: int = 0
     → return leads from db.leads matching process_id and status
     → return [{ id, name, phone, status, email }]

POST /v1/dialer/calls
     → body: { lead_id: str, process_id: str }
     → insert into db.call_sessions with status="originated", created_at=now, agent_id from JWT
     → update lead status to "calling"
     → return { call_id: str, lead_name: str, phone: str }

PATCH /v1/dialer/calls/{call_id}/status
     → body: { status: Literal["answered", "ended"] }
     → update call_sessions document, set answered_at or ended_at, compute duration if ended
     → return { success: bool }

POST /v1/dialer/calls/{call_id}/disposition
     → body: { outcome: str, notes: Optional[str], callback_time: Optional[datetime] }
     → update call_sessions with outcome/notes
     → update lead status to outcome value
     → return { success: bool }

call_sessions document schema:
{
  _id: ObjectId,
  lead_id: str,
  process_id: str,
  agent_id: str,
  project_id: str,
  status: "originated" | "answered" | "ended",
  outcome: str | None,
  notes: str | None,
  callback_time: datetime | None,
  created_at: datetime,
  answered_at: datetime | None,
  ended_at: datetime | None,
  duration_seconds: int | None
}

Then in api.py (or wherever routers are registered), add:
from routes.dialer import router as dialer_router
app.include_router(dialer_router)

## TASK 2: Create React Native Expo Dialer App

New directory: callpulse-dialer/ (sibling to backend/ and frontend/)

Tech: Expo SDK 50, TypeScript strict, React Navigation v6 Native Stack, expo-secure-store. No external UI libraries.

Design tokens (from frontend/design.json — use EXACTLY):
Primary: #6FA3D2, gradient to #89B9E3 (135deg)
Accent: #C3E836 (lime — for call button, selected states)
Background: #F5F5F7
Card: #FFFFFF, borderRadius 16, shadow 0 2px 12px rgba(0,0,0,0.06)
Text: primary #1A1A1A, secondary #6B7280, tertiary #9CA3AF
Success: #10B981, Error: #EF4444, Warning: #F59E0B, Border: #E5E7EB
Spacing: xs=4 sm=8 md=12 lg=16 xl=24 2xl=32 3xl=48
Radius: sm=4 base=8 md=12 lg=16 xl=24 full=9999
Typography sizes: xs=11 sm=12 base=14 md=16 lg=18 xl=24 2xl=32
Font weights as STRINGS ("600" not 600) for React Native

Files to generate:
1. callpulse-dialer/theme.ts — all tokens above as typed const object
2. callpulse-dialer/types/index.ts — Agent, Campaign, Lead, CallSession, Disposition, DispositionPayload
3. callpulse-dialer/services/api.ts — fetch wrappers for all 7 endpoints. BASE_URL=http://localhost:8000. JWT from expo-secure-store. On 401 throw AuthError.
4. callpulse-dialer/navigation/RootNavigator.tsx — Native Stack: Login → Campaigns → Leads → Call → Disposition
5. callpulse-dialer/screens/LoginScreen.tsx
6. callpulse-dialer/screens/CampaignScreen.tsx
7. callpulse-dialer/screens/LeadsScreen.tsx
8. callpulse-dialer/screens/CallScreen.tsx (with live call timer using useEffect + setInterval)
9. callpulse-dialer/screens/DispositionScreen.tsx
10. callpulse-dialer/App.tsx — SafeAreaProvider + NavigationContainer + RootNavigator

RN rules (strict):
- TouchableOpacity activeOpacity={0.85} on ALL pressables
- SafeAreaView only in App.tsx root
- StyleSheet.create for static styles; inline only for dynamic (selected, conditional)
- showsVerticalScrollIndicator={false} on all ScrollViews and FlatLists
- KeyboardAvoidingView on LoginScreen and DispositionScreen

Screen specs — see plan.md in the repo root for full visual spec.

Generate ALL files completely. No placeholders or TODOs. Follow exact patterns from existing codebase.
```

---

## 8. Key Files Reference

| File | Purpose |
|------|---------|
| `backend/routes/leads.py` | MongoDB CRUD pattern to follow |
| `backend/routes/auth.py` | JWT auth pattern (`get_current_user`) |
| `backend/routes/webhook_dailer.py` | Existing dialer webhook (token-based) |
| `backend/utils/database.py` | MongoDB client imports |
| `frontend/design.json` | Single source of truth for all design tokens |
| `frontend/tailwind.config.ts` | Web design token implementation reference |

---

*Generated: May 2026 | Project: CallPulse Dialer | Branch: dev*