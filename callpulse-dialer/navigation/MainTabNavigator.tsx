import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import DashboardScreen from "../screens/DashboardScreen";
import DialerScreen from "../screens/DialerScreen";
import AppTabBar from "./AppTabBar";
import CampaignsStack from "./CampaignsStack";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

type Props = {
  onLoggedOut: () => void;
};

export default function MainTabNavigator({ onLoggedOut }: Props) {
  return (
    <Tab.Navigator
      initialRouteName="Dashboard"
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: true,
      }}
    >
      <Tab.Screen name="Dashboard">
        {(props) => <DashboardScreen {...props} onLoggedOut={onLoggedOut} />}
      </Tab.Screen>
      <Tab.Screen name="Dial" component={DialerScreen} />
      <Tab.Screen name="Campaigns">{() => <CampaignsStack onLoggedOut={onLoggedOut} />}</Tab.Screen>
    </Tab.Navigator>
  );
}
