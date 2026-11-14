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
  ProfileScreen,
} from "./src/screens/ResearchScreens";

const screens = {
  profile: ProfileScreen,
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
  if (!ready) return <p role="status">Loading workspace…</p>;
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
    <WorkspaceProvider>
      <Workspace />
    </WorkspaceProvider>
  );
}
