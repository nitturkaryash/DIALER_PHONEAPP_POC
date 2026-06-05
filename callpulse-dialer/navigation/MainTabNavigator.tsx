import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import DashboardScreen from "../screens/DashboardScreen";
import DialerScreen from "../screens/DialerScreen";
import InboxScreen from "../screens/InboxScreen";
import MoreScreen from "../screens/MoreScreen";
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
      initialRouteName="Home"
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: true,
      }}
    >
      <Tab.Screen name="Home">
        {(props) => <DashboardScreen {...props} onLoggedOut={onLoggedOut} />}
      </Tab.Screen>
      <Tab.Screen name="Leads">{() => <CampaignsStack onLoggedOut={onLoggedOut} />}</Tab.Screen>
      <Tab.Screen name="Dial" component={DialerScreen} />
      <Tab.Screen name="Inbox" component={InboxScreen} />
      <Tab.Screen name="More">{() => <MoreScreen onLoggedOut={onLoggedOut} />}</Tab.Screen>
    </Tab.Navigator>
  );
}
