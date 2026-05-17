/** Strip non-digits from raw keypad input. */
export function digitsOnly(value: string): string {
  return (value || "").replace(/\D+/g, "");
}

/** Normalize to E.164-style string (mirrors backend campaign_service._normalize_phone). */
export function normalizePhone(value: string): string {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

/** Display formatting for keypad UI (groups of digits). */
export function formatPhoneDisplay(raw: string): string {
  const d = digitsOnly(raw);
  if (!d) return "";
  if (d.length <= 10) {
    const a = d.slice(0, 5);
    const b = d.slice(5);
    return b ? `${a} ${b}` : a;
  }
  if (d.startsWith("91") && d.length === 12) {
    const local = d.slice(2);
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  return `+${d}`;
}

export function isValidDialLength(raw: string): boolean {
  const d = digitsOnly(raw);
  return d.length >= 10;
}
