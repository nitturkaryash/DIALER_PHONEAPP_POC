from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Optional


@dataclass
class TranscriptSegment:
    text: str
    speaker_id: str
    end: float


@dataclass
class CallTranscript:
    segments: list[TranscriptSegment]


def _strip_chat_prefix(line: str) -> str:
    return re.sub(r"^\[[^\]]+\]\s*[^:]+:\s*", "", line).strip()


def _normalize_match_text(value: str) -> str:
    normalized = re.sub(r"[^\w\s]+", " ", value.lower(), flags=re.UNICODE)
    normalized = normalized.replace("_", " ")
    return re.sub(r"\s+", " ", normalized).strip()


def _extract_ivr_phrases(ai_context: Optional[str]) -> list[str]:
    if not ai_context:
        return []

    context = ai_context.strip()
    if not context:
        return []

    phrases: list[str] = []
    for match in re.findall(r"[\"“”](.+?)[\"“”]", context, flags=re.DOTALL):
        cleaned = match.strip()
        if cleaned:
            phrases.append(cleaned)

    for line in context.splitlines():
        cleaned = _strip_chat_prefix(line).strip(" -•\t")
        if not cleaned:
            continue
        lower = cleaned.lower()
        if "ivr" in lower or "example" in lower or "e.g" in lower or "score full" in lower:
            continue
        if len(cleaned) < 5:
            continue
        phrases.append(cleaned)

    if not phrases:
        phrases.extend(
            [
                "the number you have dialed is busy",
                "all circuits are busy",
                "on another call",
                "forwarded to voicemail",
                "your call has been forwarded to voicemail",
            ]
        )

    return list(dict.fromkeys(phrases))


def build_call_transcript_from_turns(turns: list[dict]) -> CallTranscript:
    segments: list[TranscriptSegment] = []
    end = 0.0
    for turn in turns or []:
        actor = str((turn or {}).get("actor") or "").strip().lower()
        text = str((turn or {}).get("text") or "").strip()
        if not text:
            continue
        # Keep a monotonic synthetic timeline for heuristic duration checks.
        end += max(1.0, len(text.split()) * 0.35)
        speaker_id = "assistant" if actor == "assistant" else ("user" if actor == "user" else actor or "unknown")
        segments.append(TranscriptSegment(text=text, speaker_id=speaker_id, end=end))
    return CallTranscript(segments=segments)


def detect_ivr_from_turns(turns: list[dict], ai_context: Optional[str] = None) -> bool:
    return _detect_ivr_call(build_call_transcript_from_turns(turns or []), ai_context)


def _detect_ivr_call(transcript: CallTranscript, ai_context: Optional[str]) -> bool:
    if not transcript or not transcript.segments:
        return True

    transcript_text = " ".join(seg.text for seg in transcript.segments if seg.text)
    normalized_transcript = _normalize_match_text(transcript_text)
    if not normalized_transcript or len(normalized_transcript.strip()) == 0:
        return True

    alpha_chars = sum(1 for c in transcript_text if c.isalpha())
    total_chars = len(transcript_text.replace(" ", ""))
    if total_chars > 0 and alpha_chars < total_chars * 0.3:
        return True

    words = normalized_transcript.split()
    if len(words) > 0:
        avg_word_length = sum(len(w) for w in words) / len(words)
        if avg_word_length < 2.0 and len(words) < 10:
            return True

    conversational_indicators = [
        r"\b(what|how|when|where|why|which|who)\b.*\?",
        r"\b(can i|may i|could you|would you|do you|are you)\b",
        r"\b(yes|no|okay|ok|sure|alright|thanks|thank you|welcome)\b",
        r"\b(haan|nahi|theek|sahi|dhanyavad|haudu)\b",
        r"\b(haudu|illa|sari|aytu|alva|sar|madam)\b",
        r"\b(aam|illai|sari|nandri)\b",
        r"\b(avunu|kaadu|sare|dhanyavadalu)\b",
        r"\b(i see|i understand|let me|i will|i can)\b",
        r"\b(sorry|apologize|help you|assist you)\b",
        r"\b(i am|you are|we are|my|your|our|nimma|nimage|nanu|neevu)\b",
        r"\b(feedback|rating|marks|service|engineer|appointment|visit)\b",
        r"\b(confirm|check|signature|otp|serial number)\b",
    ]

    has_conversation = any(re.search(pattern, normalized_transcript, re.IGNORECASE) for pattern in conversational_indicators)
    call_duration = max((seg.end for seg in transcript.segments if seg.end), default=0) if transcript.segments else 0
    word_count = len(words)
    speakers = set(seg.speaker_id for seg in transcript.segments) if transcript.segments else set()

    if len(speakers) >= 2 and call_duration > 30 and word_count > 50:
        return False

    business_conversation_patterns = [
        r"\b(appointment|meeting|schedule|visit|tomorrow|yesterday|today)\b",
        r"\b(calling from|this is .* from|my name is)\b",
        r"\b(may i know|could you|can you|would you|do you)\b",
        r"\b(assistance|help you|connect you|transfer|available)\b",
        r"\b(confirm|confirmation|check|verify)\b",
    ]
    business_pattern_matches = sum(
        1 for pattern in business_conversation_patterns if re.search(pattern, normalized_transcript, re.IGNORECASE)
    )
    if business_pattern_matches >= 2 and len(speakers) >= 2:
        return False

    if transcript.segments:
        call_duration = max((seg.end for seg in transcript.segments if seg.end), default=0)
        word_count = len(normalized_transcript.split())
        speakers = set(seg.speaker_id for seg in transcript.segments)
        if call_duration < 3.0 and word_count < 5:
            if len(speakers) >= 2:
                return False
            greeting_patterns = [
                r"\b(hello|hi|hey|hola|namaste|namaskar|good\s+(morning|afternoon|evening))\b",
                r"\b(how\s+(can|may)\s+i\s+help)\b",
                r"\b(thank\s+you\s+for\s+calling)\b",
            ]
            is_just_greeting = any(re.search(pattern, normalized_transcript, re.IGNORECASE) for pattern in greeting_patterns)
            if is_just_greeting:
                return False
            return True

        if call_duration > 0:
            word_density = word_count / call_duration
            if word_density < 2.5 and len(speakers) == 1 and word_count < 20:
                return True

    universal_ivr_patterns = [
        r"\b(press|dial|daba|dabao|daba[ey]|push|click)\s*[0-9#*]+\b",
        r"\b[0-9]\s*(press|daba|push)\b",
        r"\bpress\s+(one|two|three|four|five|six|seven|eight|nine|zero|star|hash)\b",
        r"\b(option|menu|choice|vikalp|chunav)\s*[0-9]\b",
        r"\bfor\s+\w+\s+(press|dial|daba)\s*[0-9]\b",
        r"\b(busy|vyast|bizi|व्यस्त|ব্যস্ত|వ్యస్త|ವ್ಯಸ್ತ|വ്യസ്തം|பிஸி|బిజీ)\b",
        r"\b(subscriber|caller|number|line|phone)\s+(is|hai|aahe|unde|இருக்கிறது|ఉంది)\s+(busy|engaged|vyast)\b",
        r"\b(line|number)\s+(busy|engaged)\b",
        r"\b(switch|switched)\s*(off|band|बंद|ಬಂದ್|ஆஃப்|ఆఫ్)\b",
        r"\b(phone|mobile)\s+(off|band|switched)\b",
        r"\b(not|nahi|illa|లేదు|இல்லை|இಲ್ಲ|नाही)\s+(available|reachable|uplabdh|கிடைக்கவில்லை|అందుబాటులో)\b",
        r"\b(unavailable|unreachable)\b",
        r"\b(voicemail|voice\s*mail|message|sandesh|संदेश)\b",
        r"\b(leave|chhod|छोड़)\s+(message|sandesh)\b",
        r"\bafter\s+the\s+(beep|tone)\b",
        r"\b(circuit|network|line)s?\s+(busy|engaged|unavailable)\b",
        r"\ball\s+circuits\s+are\s+busy\b",
        r"\b(try|call|koshish)\s+(later|baad|తర్వాత|பின்னர்|नंतर)\b",
        r"\b(please|kripya|कृपया|దయచేసి|தயவு)\s+(wait|hold|try|pratiksha)\b",
        r"aapan jya vyaktis call karit aahat",
        r"aap jis vyakti ko call kar rahe hain",
        r"uttar det nahi",
        r"nantra prayatna kara",
        r"nantar prayatna kara",
        r"आपण ज्या व्यक्तीस कॉल करीत आहात",
        r"आप जिस व्यक्ति को कॉल कर रहे हैं",
        r"उत्तर देत नाही",
        r"प्रयत्न करा",
        r"पहुंच से बाहर",
        r"संपर्क के बाहर",
        r"\b(out\s+of|not\s+in)\s+service\b",
        r"\b(invalid|wrong|galat)\s+number\b",
        r"[#*]{2,}",
        r"\b(forwarded|transfer|connect|hold|wait)\b.*\b(voicemail|message|agent)\b",
    ]

    for pattern in universal_ivr_patterns:
        if re.search(pattern, normalized_transcript, re.IGNORECASE | re.UNICODE):
            if len(speakers) >= 2 and call_duration > 20:
                weak_patterns = [r"\b(forwarded|transfer|connect|hold|wait)\b.*\b(voicemail|message|agent)\b"]
                if any(re.match(weak, pattern) for weak in weak_patterns):
                    continue
            return True

    high_confidence_ivr_keywords = [
        "number you have dialed",
        "number you have dialled",
        "circuits are busy",
        "all circuits are busy",
        "forwarded to voicemail",
        "leave a message",
        "on another call",
        "currently busy",
        "out of service",
        "not in service",
        "phone is switched off",
        "temporarily unavailable",
        "busy signal",
        "busy tone",
        "automated message",
        "automated voice",
        "system message",
        "recorded message",
        "after the beep",
        "after the tone",
        "mailbox is full",
        "voicemail box",
        "unable to take your call",
        "please leave your name and number",
        "transferring your call",
        "please hold while we transfer",
        "connecting you to",
        "forwarding your call",
        "please wait while we connect",
        "your call is important to us",
        "please hold",
        "please stay on the line",
        "all our representatives are busy",
        "your call will be answered",
        "you are number",
        "in the queue",
        "estimated wait time",
        "we are currently closed",
        "office is closed",
        "business hours are",
        "please call back during",
        "operating hours",
        "closed for the day",
        "number is not in service",
        "number has been disconnected",
        "no longer in service",
        "invalid number",
        "number you dialed is incorrect",
        "network is busy",
        "service is temporarily unavailable",
        "experiencing technical difficulties",
        "aapan jya vyaktis",
        "vyaktis call karit aahat",
        "uttar det nahi",
        "nantra prayatna kara",
        "nantar prayatna kara",
        "kakshi baher",
        "aap jis vyakti ko",
        "vyakti ko call kar rahe",
        "abhi vyast hai",
        "uttar nahi de rahe",
        "kripya kuch samay paschat",
        "pashchat prayas kare",
        "pahunch se bahar",
        "pahohoch baher",
        "sampark ke bahar",
        "bisiyaaga ullathu",
        "bisiyaga ullathu",
        "veroru nabarudan",
        "pesik kondu",
        "kaaryaniaratavaagide",
        "dayal maadida",
        "dwara dayal",
        "dayal kiya",
        "abhi vyast",
        "vyast hai",
        "pashchat prayas",
        "prayas kari",
    ]

    for keyword in high_confidence_ivr_keywords:
        if _normalize_match_text(keyword) in normalized_transcript:
            if has_conversation and len(speakers) >= 2 and call_duration > 15 and word_count > 30:
                continue
            return True

    ambiguous_ivr_keywords = [
        "bisiyaaga",
        "bisiyaga",
        "bisi",
        "nabar",
        "nambaru",
        "kaththirukkalaam",
        "kathiru",
        "muyarchikkavum",
        "muyarchi",
        "pinnaar",
        "pinna",
        "ullathu",
        "ulladu",
        "sankhyeyu",
        "sankhye",
        "vyasta",
        "prayathnisi",
        "prayathna",
        "dayavittu",
        "daya",
        "nanthara",
        "dayal",
        "kuch samay",
    ]

    if transcript.segments:
        call_duration = max((seg.end for seg in transcript.segments if seg.end), default=0)
        word_count = len(normalized_transcript.split())
        speakers = set(seg.speaker_id for seg in transcript.segments)
        is_ivr_context = len(speakers) == 1 or (call_duration < 30 and word_count < 50)
        if is_ivr_context:
            for keyword in ambiguous_ivr_keywords:
                if _normalize_match_text(keyword) in normalized_transcript:
                    return True

    speakers = set(seg.speaker_id for seg in transcript.segments)
    if len(speakers) == 1 and len(transcript.segments) > 2:
        texts = [seg.text.lower().strip() for seg in transcript.segments if seg.text]
        if len(texts) > 2:
            text_counts = Counter(texts)
            most_common_count = text_counts.most_common(1)[0][1] if text_counts else 0
            if most_common_count > len(texts) * 0.4:
                return True

    if ai_context and ai_context.strip():
        custom_phrases = _extract_ivr_phrases(ai_context)
        objection_phrases = [
            "not interested",
            "no interest",
            "not now",
            "call back later",
            "busy right now",
            "in a meeting",
            "driving",
            "cant talk",
            "cannot talk",
        ]

        for phrase in custom_phrases:
            normalized_phrase = _normalize_match_text(phrase)
            if normalized_phrase and normalized_phrase in normalized_transcript:
                is_objection = any(obj in normalized_phrase for obj in objection_phrases)
                if is_objection and len(speakers) >= 2 and call_duration > 20:
                    continue
                return True

    return False
