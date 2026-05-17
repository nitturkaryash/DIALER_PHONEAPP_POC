import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import CampaignScreen from "../screens/CampaignScreen";
import LeadsScreen from "../screens/LeadsScreen";
import { theme } from "../theme";
import type { CampaignsStackParamList } from "./types";

const Stack = createNativeStackNavigator<CampaignsStackParamList>();

type Props = {
  onLoggedOut: () => void;
};

export default function CampaignsStack({ onLoggedOut }: Props) {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.bg },
        animation: "slide_from_right",
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="CampaignList">
        {(props) => <CampaignScreen {...props} onLoggedOut={onLoggedOut} />}
      </Stack.Screen>
      <Stack.Screen name="Leads" component={LeadsScreen} />
    </Stack.Navigator>
  );
}
