import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import seed from "../data/events.json";
import type { Page, RegistryRecord, TransitionEvent } from "../types";

const STORAGE_KEY = "cstar-workspace-v1";
interface Workspace {
  ready: boolean;
  authenticated: boolean;
  login: (remember: boolean) => void;
  logout: () => void;
  page: Page;
  go: (page: Page) => void;
  events: TransitionEvent[];
  selected: TransitionEvent;
  select: (id: string) => void;
  update: (id: string, patch: Partial<TransitionEvent>) => void;
  region: string;
  setRegion: (region: string) => void;
  toast: string;
  notify: (message: string) => void;
  records: RegistryRecord[];
  addRecord: (record: RegistryRecord) => void;
  profile: { name: string; email: string };
  setProfile: (profile: { name: string; email: string }) => void;
}
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [remember, setRemember] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [events, setEvents] = useState<TransitionEvent[]>(
    seed as TransitionEvent[],
  );
  const [selectedId, setSelected] = useState("DEMO-002");
  const [region, setRegion] = useState("Aurelia Pilot Locality");
  const [toast, notify] = useState("");
  const [records, setRecords] = useState<RegistryRecord[]>([]);
  const [profile, setProfile] = useState({
    name: "Alex Reyes",
    email: "analyst@cstar.demo",
  });
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.events))
          setEvents(
            (seed as TransitionEvent[]).map((original) => {
              const event = saved.events.find(
                (item: TransitionEvent) => item.id === original.id,
              );
              return event ? { ...original, ...event } : original;
            }),
          );
        if (typeof saved.region === "string") setRegion(saved.region);
        if (Array.isArray(saved.records)) setRecords(saved.records);
        if (saved.profile?.name && saved.profile?.email)
          setProfile(saved.profile);
        if (saved.remember === true) {
          setRemember(true);
          setAuthenticated(true);
        }
      })
      .catch(() =>
        notify(
          "Saved data could not be loaded. Using the demonstration dataset.",
        ),
      )
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready) return;
    const value = JSON.stringify({
      events,
      region,
      records,
      profile,
      remember: remember && authenticated,
    });
    writes.current = writes.current
      .then(() => AsyncStorage.setItem(STORAGE_KEY, value))
      .catch(() =>
        notify(
          "Changes are available now, but could not be saved to this device.",
        ),
      );
  }, [ready, events, region, records, profile, remember, authenticated]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => notify(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <Context.Provider
      value={{
        ready,
        authenticated,
        login: (value) => {
          setRemember(value);
          setAuthenticated(true);
        },
        logout: () => {
          setRemember(false);
          setAuthenticated(false);
          setPage("overview");
        },
        page,
        go: setPage,
        events,
        selected: events.find((event) => event.id === selectedId) || events[0],
        select: setSelected,
        update: (id, patch) =>
          setEvents((current) =>
            current.map((event) =>
              event.id === id ? { ...event, ...patch } : event,
            ),
          ),
        region,
        setRegion,
        toast,
        notify,
        records,
        addRecord: (record) => setRecords((current) => [...current, record]),
        profile,
        setProfile,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error("WorkspaceProvider is required");
  return context;
}
