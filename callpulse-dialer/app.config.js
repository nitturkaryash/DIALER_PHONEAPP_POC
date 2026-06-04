const appJson = require("./app.json");

const DEV_HOST = process.env.EXPO_PUBLIC_DEV_HOST ?? "10.131.230.118";
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? `http://${DEV_HOST}:8000`;
const commonsUrl =
  process.env.EXPO_PUBLIC_COMMONS_API_URL ?? `http://${DEV_HOST}:4100`;

const metroUrl = `http://${DEV_HOST}:8081`;
const metroEncoded = encodeURIComponent(metroUrl);

/** @type {import("expo/config").ExpoConfig} */
module.exports = {
  expo: {
    ...appJson.expo,
    plugins: [...(appJson.expo.plugins ?? []), "expo-dev-client"],
    extra: {
      ...appJson.expo.extra,
      devHost: DEV_HOST,
      devMetroUrl: metroUrl,
      /** Open on phone to skip localhost: exp+callpulse-dialer://expo-development-client/?url=... */
      devClientDeepLink: `exp+callpulse-dialer://expo-development-client/?url=${metroEncoded}`,
      apiUrl,
      commonsUrl,
    },
  },
};
