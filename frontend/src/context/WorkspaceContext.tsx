import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import seed from "../data/events.json";
import { api, type WorkspaceData } from "../api";
import type { Page, RegistryRecord, TransitionEvent } from "../types";

interface Workspace {
  ready: boolean;
  authenticated: boolean;
  login: (
    remember: boolean,
    credentials?: { email: string; password: string },
  ) => Promise<void>;
  logout: () => void;
  signup: (
    name: string,
    email: string,
    password: string,
    remember: boolean,
  ) => Promise<boolean>;
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
  const version = useRef(0);
  const lastSaved = useRef("");
  const saveBlocked = useRef(false);
  function load(data: WorkspaceData) {
    version.current = data.version;
    setEvents(data.events);
    setRegion(data.region);
    setRecords(data.records);
    setProfile(data.profile);
    lastSaved.current = JSON.stringify({
      events: data.events,
      region: data.region,
      records: data.records,
      profile: data.profile,
    });
    saveBlocked.current = false;
    setAuthenticated(true);
  }
  useEffect(() => {
    api<WorkspaceData>("/workspace")
      .then(load)
      .catch((error) => {
        if (error.status !== 401) notify(error.message);
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready || !authenticated) return;
    const snapshot = { events, region, records, profile };
    const value = JSON.stringify(snapshot);
    if (value === lastSaved.current) return;
    lastSaved.current = value;
    writes.current = writes.current
      .then(async () => {
        if (saveBlocked.current) return;
        const saved = await api<WorkspaceData>("/workspace", "PUT", {
          ...snapshot,
          version: version.current,
        });
        version.current = saved.version;
        notify("Changes saved to the backend.");
      })
      .catch((error) => {
        saveBlocked.current = true;
        notify(`Changes were not saved: ${error.message} Reload to reconnect.`);
      });
  }, [ready, events, region, records, profile, authenticated]);
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
        login: async (remember, credentials) => {
          const data = await api<WorkspaceData>("/session", "POST", {
            remember,
            ...(credentials || { demo: true }),
          });
          load(data);
        },
        signup: async (name, email, password, remember) => {
          const result = await api<{
            confirmationRequired: boolean;
            workspace?: WorkspaceData;
          }>("/signup", "POST", { name, email, password, remember });
          if (result.workspace) load(result.workspace);
          return result.confirmationRequired;
        },
        logout: () => {
          void writes.current
            .then(() => api("/session", "DELETE"))
            .then(() => {
              setAuthenticated(false);
              setPage("overview");
            })
            .catch((error) => notify(error.message));
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
