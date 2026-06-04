// Expo's babel transform replaces `process.env.EXPO_PUBLIC_*` at build time.
// Declare the runtime shape so TypeScript is satisfied.
declare const process: {
  env: {
    EXPO_PUBLIC_DEV_HOST?: string;
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_COMMONS_API_URL?: string;
    EXPO_PUBLIC_ENABLE_DEV_MOCKS?: string;
    [key: string]: string | undefined;
  };
};
