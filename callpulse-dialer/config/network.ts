/**
 * Mac LAN IP for physical-phone testing (same Wi‑Fi as laptop).
 * Override via .env: EXPO_PUBLIC_DEV_HOST=...
 */
export const DEV_HOST = process.env.EXPO_PUBLIC_DEV_HOST ?? "10.131.230.118";

export const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? `http://${DEV_HOST}:8000`;

export const COMMONS_URL =
  process.env.EXPO_PUBLIC_COMMONS_API_URL ?? `http://${DEV_HOST}:4100`;

/** Metro bundler — enter this in the dev build if it fails to connect. */
export const METRO_URL = `http://${DEV_HOST}:8081`;
