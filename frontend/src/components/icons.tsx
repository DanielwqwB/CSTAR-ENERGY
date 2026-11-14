import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileText,
  Files,
  Fingerprint,
  GitCompare,
  Grid2X2,
  Info,
  List,
  LogOut,
  Map,
  Menu,
  Navigation,
  Orbit,
  Play,
  Plus,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
const icons = {
  "pulse-outline": Activity,
  "arrow-forward": ArrowRight,
  "bar-chart-outline": BarChart3,
  "notifications-outline": Bell,
  checkmark: Check,
  "chevron-down": ChevronDown,
  "download-outline": Download,
  "eye-outline": Eye,
  "eye-off-outline": EyeOff,
  "document-text-outline": FileText,
  "documents-outline": Files,
  "finger-print-outline": Fingerprint,
  "git-compare-outline": GitCompare,
  "grid-outline": Grid2X2,
  "information-circle-outline": Info,
  "list-outline": List,
  "log-out-outline": LogOut,
  "map-outline": Map,
  "menu-outline": Menu,
  "navigate-outline": Navigation,
  planet: Orbit,
  "planet-outline": Orbit,
  "play-outline": Play,
  "add-outline": Plus,
  "save-outline": Save,
  "search-outline": Search,
  "server-outline": Server,
  "settings-outline": Settings,
  "shield-checkmark-outline": ShieldCheck,
  close: X,
};
export type IconName = keyof typeof icons;
export function Icon({
  name,
  color = "#94a3b8",
  size = 18,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  const Glyph = icons[name];
  return (
    <Glyph aria-hidden="true" color={color} size={size} strokeWidth={1.8} />
  );
}
