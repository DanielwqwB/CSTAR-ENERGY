import React from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  WorkspaceProvider,
  useWorkspace,
} from "./src/context/WorkspaceContext";
import { AppShell } from "./src/components/AppShell";
import { LoginScreen } from "./src/screens/LoginScreen";
import { OverviewScreen } from "./src/screens/OverviewScreen";
import { EventsScreen } from "./src/screens/EventsScreen";
import { MapScreen } from "./src/screens/MapScreen";
import { InvestigationScreen } from "./src/screens/InvestigationScreen";
import {
  AttributionScreen,
  CounterfactualScreen,
  PlumeScreen,
  TimelineScreen,
} from "./src/screens/EvidenceScreens";
import {
  AlertsScreen,
  AnalyticsScreen,
  DataScreen,
  RecordsScreen,
  ReportsScreen,
  SettingsScreen,
} from "./src/screens/ResearchScreens";
import { colors } from "./src/theme";

const screens = {
  overview: OverviewScreen,
  map: MapScreen,
  events: EventsScreen,
  investigation: InvestigationScreen,
  timeline: TimelineScreen,
  plume: PlumeScreen,
  counterfactual: CounterfactualScreen,
  attribution: AttributionScreen,
  data: DataScreen,
  records: RecordsScreen,
  analytics: AnalyticsScreen,
  alerts: AlertsScreen,
  reports: ReportsScreen,
  settings: SettingsScreen,
};
function Workspace() {
  const { ready, authenticated, page } = useWorkspace();
  if (!ready)
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator
          accessibilityLabel="Loading workspace"
          color={colors.cyan}
        />
      </View>
    );
  if (!authenticated) return <LoginScreen />;
  const Screen = screens[page];
  return (
    <AppShell>
      <Screen />
    </AppShell>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        <WorkspaceProvider>
          <Workspace />
        </WorkspaceProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
