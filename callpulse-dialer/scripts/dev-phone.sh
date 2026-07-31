#!/usr/bin/env bash
# Start Metro for physical device. Phone cannot use localhost — use LAN IP below.

set -euo pipefail
cd "$(dirname "$0")/.."

IFACE=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
if [[ -z "${IFACE:-}" ]]; then
  echo "Could not detect default network interface."
  exit 1
fi

ENV_HOST=""
if [[ -f .env ]]; then
  ENV_HOST=$(grep -E '^EXPO_PUBLIC_DEV_HOST=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d " \t\"'" || true)
fi

if [[ -n "$ENV_HOST" ]]; then
  IP="$ENV_HOST"
else
  IP=$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)
  if [[ -z "$IP" ]]; then
    for alt in en0 en1 bridge0; do
      IP=$(ipconfig getifaddr "$alt" 2>/dev/null || true)
      [[ -n "$IP" ]] && break
    done
  fi
fi
if [[ -z "${IP:-}" ]]; then
  echo "No IP on $IFACE. Set EXPO_PUBLIC_DEV_HOST in .env or connect Wi‑Fi first."
  exit 1
fi

METRO="http://${IP}:8081"
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${METRO}', safe=''))")
DEEPLINK="exp+callpulse-dialer://expo-development-client/?url=${ENCODED}"

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Phone pe localhost MAT dabana — woh phone ka khud ka IP hai"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "  Metro URL (manual entry):  ${METRO}"
echo ""
echo "  Steps:"
echo "    1) npm run dev:phone chal raha ho (ye script)"
echo "    2) CallPulse dev app kholo"
echo "    3) 'Enter URL manually' → paste: ${METRO}"
echo "       YA recent 'localhost' entry DELETE / mat chhedo"
echo "    4) Agar phir bhi localhost aaye: App info → Storage → Clear data"
echo "    5) Phir step 3 dubara"
echo ""
echo "  Deep link (Chrome / Notes se open karo, app khul sakti hai):"
echo "    ${DEEPLINK}"
echo ""
echo "  LAN fail ho to: npm run dev:tunnel"
echo "══════════════════════════════════════════════════════════"
echo ""

export REACT_NATIVE_PACKAGER_HOSTNAME="$IP"
exec npx expo start --dev-client --host lan
