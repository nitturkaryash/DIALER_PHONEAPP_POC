import { Platform } from "react-native";
import { registerRootComponent } from "expo";

// Do not import LiveKit native modules here.
// Expo Go cannot load them at app startup.

import App from "./App";

registerRootComponent(App);
