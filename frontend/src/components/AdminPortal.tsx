import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ClipboardList,
  Database,
  FileCheck2,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPinned,
  RefreshCw,
  Users,
} from "lucide-react";
import logo from "../../assets/cstar-logo.png";
import { api } from "../api";
import { useWorkspace } from "../context/WorkspaceContext";

type AdminPage =
  | "dashboard"
  | "users"
  | "lgu"
  | "jurisdictions"
  | "datasets"
  | "reports"
  | "publications"
  | "monitoring"
  | "audit";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "LGU" | "RESEARCHER" | "RESIDENT";
  status: "ACTIVE" | "SUSPENDED";
  approval_status: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  jurisdiction_id: string | null;
  created_at: string;
  updated_at: string;
};

type Jurisdiction = {
  id: string;
  name: string;
  code: string;
  level: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type CommunityReport = {
  id: string;
  owner_id: string;
  jurisdiction_id: string;
  assigned_to: string | null;
  title: string;
  description: string;
  status: "PENDING" | "UNDER_REVIEW" | "ACTION_PLANNED" | "RESOLVED" | "REJECTED";
  created_at: string;
};

type Dataset = {
  dataset_id?: string;
  name: string;
  product: string;
  scale: string;
  status: string;
  description: string;
  classification?: string;
};

type AuditLog = {
  id: number;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  created_at: string;
};

type Publication = {
  id: string;
  jurisdiction_id: string | null;
  title: string;
  summary: string;
  url: string;
  published_at: string;
};

type AdminDashboard = {
  metrics: {
    totalUsers: number;
    activeLgus: number;
    activeResearchers: number;
    registeredResidents: number;
    pendingApprovals: number;
    activeJurisdictions: number;
    pendingReports: number;
    failedJobs: number | null;
  };
  activity: AuditLog[];
};

type Health = {
  status: string;
  service: string;
  databaseStatus: string;
  databaseReachable: boolean | null;
};

type AdminData = {
  dashboard?: AdminDashboard;
  health?: Health;
  users?: AdminUser[];
  jurisdictions?: Jurisdiction[];
  reports?: CommunityReport[];
  datasets?: Dataset[];
  logs?: AuditLog[];
  publications?: Publication[];
};

const navigation: {
  id: AdminPage;
  label: string;
  icon: typeof LayoutDashboard;
}[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "users", label: "User Management", icon: Users },
  { id: "lgu", label: "LGU Management", icon: MapPinned },
  { id: "jurisdictions", label: "Geographic Jurisdictions", icon: MapPinned },
  { id: "datasets", label: "Satellite Data", icon: Database },
  { id: "reports", label: "Community Reports", icon: ClipboardList },
  { id: "publications", label: "Research & Publications", icon: FileCheck2 },
  { id: "monitoring", label: "System Monitoring", icon: Activity },
  { id: "audit", label: "Audit Logs", icon: FileText },
];

const pageTitles: Record<AdminPage, string> = {
  dashboard: "Platform operations",
  users: "User management",
  lgu: "LGU accounts",
  jurisdictions: "Geographic jurisdictions",
  datasets: "Satellite data management",
  reports: "Community reports",
  publications: "Research & publications",
  monitoring: "System monitoring",
  audit: "Audit logs",
};

const pageFromPath = (path: string): AdminPage => {
  const slug = path.split("/").filter(Boolean)[1];
  return navigation.some((item) => item.id === slug)
    ? (slug as AdminPage)
    : "dashboard";
};

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "—";

function Panel({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-panel">
      <header className="admin-panel-header">
        <div>
          {eyebrow && <span className="admin-eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      <div className="admin-panel-body">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}

function Status({ value }: { value?: string | null }) {
  const normalized = value?.toLowerCase().replaceAll("_", " ") || "unknown";
  return (
    <span className="admin-status" data-status={normalized}>
      {normalized}
    </span>
  );
}

function AdminTable({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function AdminPortal() {
  const { account, logout, toast } = useWorkspace();
  const [page, setPage] = useState<AdminPage>(() =>
    pageFromPath(window.location.pathname),
  );
  const [data, setData] = useState<AdminData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<AdminUser["role"]>("RESIDENT");
  const [formJurisdiction, setFormJurisdiction] = useState("");
  const [newJurisdictionName, setNewJurisdictionName] = useState("");
  const [newJurisdictionCode, setNewJurisdictionCode] = useState("");
  const [newJurisdictionLevel, setNewJurisdictionLevel] = useState("MUNICIPALITY");
  const [creatingJurisdiction, setCreatingJurisdiction] = useState(false);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/admin/")) {
      window.history.replaceState(null, "", "/admin/dashboard");
      setPage("dashboard");
    }
    const onPopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const load = async () => {
      let next: AdminData;
      if (page === "dashboard") {
        const [dashboard, health] = await Promise.all([
          api<AdminDashboard>("/admin/dashboard"),
          api<Health>("/health"),
        ]);
        next = { dashboard, health };
      } else if (page === "users" || page === "lgu") {
        const [result, jurisdictions] = await Promise.all([
          api<{ users: AdminUser[] }>("/admin/users"),
          api<{ jurisdictions: Jurisdiction[] }>("/admin/jurisdictions"),
        ]);
        next = { users: result.users, jurisdictions: jurisdictions.jurisdictions };
      } else if (page === "jurisdictions") {
        const result = await api<{ jurisdictions: Jurisdiction[] }>("/admin/jurisdictions");
        next = { jurisdictions: result.jurisdictions };
      } else if (page === "datasets") {
        const result = await api<{ datasets: Dataset[] }>("/admin/datasets");
        next = { datasets: result.datasets };
      } else if (page === "reports") {
        const [reports, users] = await Promise.all([
          api<{ reports: CommunityReport[] }>("/admin/reports"),
          api<{ users: AdminUser[] }>("/admin/users"),
        ]);
        next = { reports: reports.reports, users: users.users };
      } else if (page === "publications") {
        const result = await api<{ publications: Publication[] }>("/publications");
        next = { publications: result.publications };
      } else if (page === "monitoring") {
        const [health, dashboard] = await Promise.all([
          api<Health>("/health"),
          api<AdminDashboard>("/admin/dashboard"),
        ]);
        next = { health, dashboard };
      } else {
        const result = await api<{ logs: AuditLog[] }>("/admin/audit-logs");
        next = { logs: result.logs };
      }
      if (active) setData(next);
    };
    void load()
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "The admin data could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, refreshKey]);

  const filteredUsers = useMemo(() => {
    let users = data.users ?? [];
    if (page === "lgu") users = users.filter((user) => user.role === "LGU");
    if (roleFilter) users = users.filter((user) => user.role === roleFilter);
    if (statusFilter) users = users.filter((user) => user.status === statusFilter);
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery) {
      users = users.filter(
        (user) =>
          user.name.toLowerCase().includes(normalizedQuery) ||
          user.email.toLowerCase().includes(normalizedQuery),
      );
    }
    return users;
  }, [data.users, page, query, roleFilter, statusFilter]);

  const navigate = (next: AdminPage) => {
    setPage(next);
    setQuery("");
    setRoleFilter("");
    setStatusFilter("");
    window.history.pushState(null, "", `/admin/${next}`);
  };

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      setRefreshKey((current) => current + 1);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The requested change failed.");
      return false;
    }
  };

  const updateUser = async (
    user: AdminUser,
    changes: Record<string, unknown>,
    description: string,
  ) => {
    if (user.id === account?.id && changes.role !== undefined) {
      setError("You cannot change your own administrator role.");
      return;
    }
    if (!window.confirm(`${description} for ${user.name}?`)) return;
    await mutate(
      () => api(`/admin/users/${encodeURIComponent(user.id)}`, "PATCH", changes),
      `${description} updated.`,
    );
  };

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    if (["LGU", "RESEARCHER"].includes(formRole) && !formJurisdiction) {
      setError("Select a jurisdiction for LGU and researcher accounts.");
      return;
    }
    if (!window.confirm(`Create a ${formRole} account for ${formEmail}?`)) return;
    setCreating(true);
    const saved = await mutate(
      () =>
        api("/admin/users", "POST", {
          name: formName.trim(),
          email: formEmail.trim(),
          password: formPassword,
          role: formRole,
          jurisdiction_id: formJurisdiction || null,
        }),
      "Account created.",
    );
    setCreating(false);
    if (saved) {
      setFormName("");
      setFormEmail("");
      setFormPassword("");
      setFormJurisdiction("");
      setShowCreateUser(false);
    }
  };

  const createJurisdiction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingJurisdiction) return;
    if (!window.confirm(`Create the jurisdiction "${newJurisdictionName}"?`)) return;
    setCreatingJurisdiction(true);
    const saved = await mutate(
      () =>
        api("/admin/jurisdictions", "POST", {
          name: newJurisdictionName.trim(),
          code: newJurisdictionCode.trim(),
          level: newJurisdictionLevel,
        }),
      "Jurisdiction created.",
    );
    setCreatingJurisdiction(false);
    if (saved) {
      setNewJurisdictionName("");
      setNewJurisdictionCode("");
    }
  };

  const title = pageTitles[page];
  const ActiveIcon = navigation.find((item) => item.id === page)?.icon ?? LayoutDashboard;

  return (
    <div className="data-workspace admin-workspace">
      <header className="admin-topbar">
        <a className="admin-brand" href="/admin/dashboard" onClick={(event) => {
          event.preventDefault();
          navigate("dashboard");
        }}>
          <img src={logo} alt="" width={38} height={38} />
          <span><strong>CSTAR</strong>-ENERGY<small>PLATFORM ADMINISTRATION</small></span>
        </a>
        <div className="admin-account">
          <span className="admin-role-chip">ADMIN</span>
          <span className="admin-account-name">{account?.name ?? account?.email}</span>
          <button type="button" className="admin-signout" onClick={() => void logout()}>
            <LogOut size={15} /><span>Sign out</span>
          </button>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-heading">
            <span className="admin-eyebrow">PLATFORM OPERATIONS</span>
            <strong>Administration</strong>
          </div>
          <nav aria-label="Admin navigation">
            {navigation.map((item) => {
              const Glyph = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-current={page === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <Glyph size={16} /><span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="admin-sidebar-foot">
            <span>Signed in as</span>
            <strong>{account?.email}</strong>
            <span>Role and data access are enforced by the API.</span>
          </div>
        </aside>
        <main className="admin-main">
          <header className="admin-page-heading">
            <div>
              <span className="admin-eyebrow"><ActiveIcon size={13} /> ADMINISTRATION</span>
              <h1>{title}</h1>
              <p>Platform management and operational status from connected services.</p>
            </div>
            <button
              type="button"
              className="admin-refresh"
              onClick={() => setRefreshKey((current) => current + 1)}
              disabled={loading}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </header>
          {(error || notice || toast) && (
            <div className={`admin-message${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
              {error || notice || toast}
            </div>
          )}
          {loading ? (
            <div className="admin-loading" role="status">Loading {title.toLowerCase()}…</div>
          ) : error && Object.keys(data).length === 0 ? (
            <div className="admin-load-error">
              <p>{error}</p>
              <button type="button" onClick={() => setRefreshKey((current) => current + 1)}>Try again</button>
            </div>
          ) : (
            <AdminPageContent
              page={page}
              data={data}
              accountId={account?.id ?? ""}
              users={filteredUsers}
              query={query}
              setQuery={setQuery}
              roleFilter={roleFilter}
              setRoleFilter={setRoleFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              showCreateUser={showCreateUser}
              setShowCreateUser={setShowCreateUser}
              formName={formName}
              setFormName={setFormName}
              formEmail={formEmail}
              setFormEmail={setFormEmail}
              formPassword={formPassword}
              setFormPassword={setFormPassword}
              formRole={formRole}
              setFormRole={setFormRole}
              formJurisdiction={formJurisdiction}
              setFormJurisdiction={setFormJurisdiction}
              creating={creating}
              onCreateUser={createUser}
              onUserUpdate={updateUser}
              jurisdictionName={newJurisdictionName}
              setJurisdictionName={setNewJurisdictionName}
              jurisdictionCode={newJurisdictionCode}
              setJurisdictionCode={setNewJurisdictionCode}
              jurisdictionLevel={newJurisdictionLevel}
              setJurisdictionLevel={setNewJurisdictionLevel}
              creatingJurisdiction={creatingJurisdiction}
              onCreateJurisdiction={createJurisdiction}
              onMutate={mutate}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function AdminPageContent(props: {
  page: AdminPage;
  data: AdminData;
  accountId: string;
  users: AdminUser[];
  query: string;
  setQuery: (value: string) => void;
  roleFilter: string;
  setRoleFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  showCreateUser: boolean;
  setShowCreateUser: (value: boolean) => void;
  formName: string;
  setFormName: (value: string) => void;
  formEmail: string;
  setFormEmail: (value: string) => void;
  formPassword: string;
  setFormPassword: (value: string) => void;
  formRole: AdminUser["role"];
  setFormRole: (value: AdminUser["role"]) => void;
  formJurisdiction: string;
  setFormJurisdiction: (value: string) => void;
  creating: boolean;
  onCreateUser: (event: FormEvent<HTMLFormElement>) => void;
  onUserUpdate: (
    user: AdminUser,
    changes: Record<string, unknown>,
    description: string,
  ) => void;
  jurisdictionName: string;
  setJurisdictionName: (value: string) => void;
  jurisdictionCode: string;
  setJurisdictionCode: (value: string) => void;
  jurisdictionLevel: string;
  setJurisdictionLevel: (value: string) => void;
  creatingJurisdiction: boolean;
  onCreateJurisdiction: (event: FormEvent<HTMLFormElement>) => void;
  onMutate: (action: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const { page, data } = props;
  if (page === "dashboard") return <DashboardPage dashboard={data.dashboard} health={data.health} />;
  if (page === "users" || page === "lgu") return <UsersPage {...props} />;
  if (page === "jurisdictions") return <JurisdictionsPage {...props} />;
  if (page === "datasets") return <DatasetsPage datasets={data.datasets ?? []} />;
  if (page === "reports") return <ReportsPage reports={data.reports ?? []} users={data.users ?? []} onMutate={props.onMutate} />;
  if (page === "publications") return <PublicationsPage publications={data.publications ?? []} />;
  if (page === "monitoring") return <MonitoringPage health={data.health} dashboard={data.dashboard} />;
  return <AuditPage logs={data.logs ?? []} />;
}

function DashboardPage({
  dashboard,
  health,
}: {
  dashboard?: AdminDashboard;
  health?: Health;
}) {
  if (!dashboard) return <Empty>Dashboard metrics are unavailable.</Empty>;
  const metrics = dashboard.metrics;
  const cards = [
    ["Registered users", metrics.totalUsers, "cyan"],
    ["Active LGU accounts", metrics.activeLgus, "green"],
    ["Active researchers", metrics.activeResearchers, "cyan"],
    ["Registered residents", metrics.registeredResidents, "amber"],
    ["Pending approvals", metrics.pendingApprovals, "amber"],
    ["Active jurisdictions", metrics.activeJurisdictions, "green"],
    ["Pending reports", metrics.pendingReports, "rose"],
    ["Failed background jobs", metrics.failedJobs ?? "Not reported", "muted"],
  ] as const;
  return (
    <>
      <div className="admin-metrics">
        {cards.map(([label, value, tone]) => (
          <article className="admin-metric" data-tone={tone} key={label}>
            <span>{label}</span><strong>{value}</strong>
          </article>
        ))}
      </div>
      <div className="admin-content-grid">
        <Panel title="Recent platform activity" eyebrow="AUDIT TRAIL">
          {dashboard.activity.length ? (
            <AdminTable label="Recent platform activity">
              <thead><tr><th>Action</th><th>Resource</th><th>Actor</th><th>Time</th></tr></thead>
              <tbody>{dashboard.activity.map((item) => (
                <tr key={item.id}>
                  <td>{item.action}</td><td>{item.resource_type}</td>
                  <td>{item.actor_id ?? "System"}</td><td>{formatDate(item.created_at)}</td>
                </tr>
              ))}</tbody>
            </AdminTable>
          ) : <Empty>No audit activity is available.</Empty>}
        </Panel>
        <Panel title="Connected service status" eyebrow="LIVE CHECK">
          <dl className="admin-health-list">
            <div><dt>API service</dt><dd><Status value={health?.service ?? "unknown"} /></dd></div>
            <div><dt>Configuration</dt><dd><Status value={health?.status ?? "unknown"} /></dd></div>
            <div><dt>Database configuration</dt><dd><Status value={health?.databaseStatus ?? "unknown"} /></dd></div>
            <div><dt>Database reachability</dt><dd>{health?.databaseReachable === null || health?.databaseReachable === undefined ? "Not checked by health endpoint" : health.databaseReachable ? "Reachable" : "Unavailable"}</dd></div>
          </dl>
          <p className="admin-footnote">Pipeline and job metrics are not reported by the connected backend.</p>
        </Panel>
      </div>
    </>
  );
}

function UsersPage(props: Parameters<typeof AdminPageContent>[0]) {
  const {
    page, data, users, query, setQuery, roleFilter, setRoleFilter,
    statusFilter, setStatusFilter, showCreateUser, setShowCreateUser,
    formName, setFormName, formEmail, setFormEmail, formPassword, setFormPassword,
    formRole, setFormRole, formJurisdiction, setFormJurisdiction, creating,
    onCreateUser, onUserUpdate,
  } = props;
  const isLgu = page === "lgu";
  const roles: AdminUser["role"][] = ["ADMIN", "LGU", "RESEARCHER", "RESIDENT"];
  return (
    <>
      <Panel
        title={isLgu ? "Local Government Unit accounts" : "Accounts"}
        eyebrow={isLgu ? "LGU ACCESS" : "IDENTITY & ACCESS"}
        action={<button className="admin-primary-button" type="button" onClick={() => {
          setFormRole(isLgu ? "LGU" : "RESIDENT");
          setShowCreateUser(!showCreateUser);
        }}>{showCreateUser ? "Close form" : "Create account"}</button>}
      >
        {showCreateUser && (
          <form className="admin-form-grid" onSubmit={onCreateUser}>
            <label>Full name<input required maxLength={100} value={formName} onChange={(event) => setFormName(event.currentTarget.value)} /></label>
            <label>Email<input required type="email" value={formEmail} onChange={(event) => setFormEmail(event.currentTarget.value)} /></label>
            <label>Temporary password<input required type="password" minLength={8} value={formPassword} onChange={(event) => setFormPassword(event.currentTarget.value)} /></label>
            <label>Role<select value={formRole} disabled={isLgu} onChange={(event) => setFormRole(event.currentTarget.value as AdminUser["role"])}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
            <label>Jurisdiction<select value={formJurisdiction} onChange={(event) => setFormJurisdiction(event.currentTarget.value)}><option value="">No jurisdiction</option>{(data.jurisdictions ?? []).filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></label>
            <div className="admin-form-actions"><button className="admin-primary-button" type="submit" disabled={creating}>{creating ? "Creating…" : "Create account"}</button><span>Passwords are submitted only to the backend account-creation endpoint.</span></div>
          </form>
        )}
        <div className="admin-toolbar">
          <label className="admin-search">Search accounts<input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Name or email" /></label>
          {!isLgu && <label>Role<select value={roleFilter} onChange={(event) => setRoleFilter(event.currentTarget.value)}><option value="">All roles</option>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>}
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select></label>
          <span>{users.length} account{users.length === 1 ? "" : "s"}</span>
        </div>
        {users.length ? (
          <AdminTable label={isLgu ? "LGU accounts" : "User management"}>
            <thead><tr><th>Name / email</th><th>Role</th><th>Jurisdiction</th><th>Approval</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>{users.map((user) => {
              const isSelf = user.id === props.accountId;
              return <tr key={user.id}>
                <td><strong>{user.name}</strong><small>{user.email}</small></td>
                <td><select aria-label={`Role for ${user.email}`} value={user.role} disabled={isSelf} onChange={(event) => void onUserUpdate(user, { role: event.currentTarget.value }, "Change role")}><option value="ADMIN">ADMIN</option><option value="LGU">LGU</option><option value="RESEARCHER">RESEARCHER</option><option value="RESIDENT">RESIDENT</option></select></td>
                <td>
                  <select
                    aria-label={`Jurisdiction for ${user.email}`}
                    value={user.jurisdiction_id ?? ""}
                    onChange={(event) => void onUserUpdate(
                      user,
                      { jurisdiction_id: event.currentTarget.value || null },
                      "Change jurisdiction",
                    )}
                  >
                    <option value="">Unassigned</option>
                    {(data.jurisdictions ?? []).filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </td>
                <td><Status value={user.approval_status} /></td>
                <td><Status value={user.status} /></td>
                <td>{formatDate(user.created_at)}</td>
                <td className="admin-row-actions">
                  {user.approval_status === "PENDING" && <><button type="button" onClick={() => void onUserUpdate(user, { approvalStatus: "APPROVED" }, "Approve account")}>Approve</button><button type="button" onClick={() => void onUserUpdate(user, { approvalStatus: "REJECTED" }, "Reject account")}>Reject</button></>}
                  {!isSelf && <button type="button" onClick={() => void onUserUpdate(user, { status: user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }, user.status === "ACTIVE" ? "Suspend account" : "Reactivate account")}>{user.status === "ACTIVE" ? "Suspend" : "Reactivate"}</button>}
                  {isSelf && <span>Current account</span>}
                </td>
              </tr>;
            })}</tbody>
          </AdminTable>
        ) : <Empty>No accounts match these filters.</Empty>}
        <p className="admin-footnote">Password reset, last-login history, and organization records are not exposed by the current API. Admins cannot change their own role.</p>
      </Panel>
      {isLgu && (
        <Panel title="Jurisdiction assignment" eyebrow="ACCESS SCOPE">
          <p className="admin-footnote">LGU account access is limited by the assigned jurisdiction enforced by backend row-level security. Assignments are updated from User Management; organization-level administration is not yet available.</p>
        </Panel>
      )}
    </>
  );
}

function JurisdictionsPage(props: Parameters<typeof AdminPageContent>[0]) {
  const { data } = props;
  const jurisdictions = data.jurisdictions ?? [];
  return (
    <Panel title="Monitoring jurisdictions" eyebrow="GEOGRAPHIC ACCESS" action={<span className="admin-readonly-note">No boundary geometry in this API</span>}>
      <form className="admin-form-grid admin-jurisdiction-form" onSubmit={props.onCreateJurisdiction}>
        <label>Jurisdiction name<input required maxLength={200} value={props.jurisdictionName} onChange={(event) => props.setJurisdictionName(event.currentTarget.value)} /></label>
        <label>Code<input required pattern="[A-Za-z0-9][A-Za-z0-9_-]*" maxLength={40} value={props.jurisdictionCode} onChange={(event) => props.setJurisdictionCode(event.currentTarget.value)} /></label>
        <label>Level<select value={props.jurisdictionLevel} onChange={(event) => props.setJurisdictionLevel(event.currentTarget.value)}>{["PROVINCE", "CITY", "MUNICIPALITY", "BARANGAY", "REGION", "LOCAL"].map((level) => <option key={level}>{level}</option>)}</select></label>
        <div className="admin-form-actions"><button className="admin-primary-button" disabled={props.creatingJurisdiction}>{props.creatingJurisdiction ? "Creating…" : "Add jurisdiction"}</button><span>Create is supported; editing, archiving, and map boundaries are not connected.</span></div>
      </form>
      {jurisdictions.length ? <AdminTable label="Geographic jurisdictions">
        <thead><tr><th>Name</th><th>Code</th><th>Level</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>{jurisdictions.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.code}</td><td>{item.level}</td><td><Status value={item.status} /></td><td>{formatDate(item.created_at)}</td></tr>)}</tbody>
      </AdminTable> : <Empty>No jurisdictions are registered.</Empty>}
    </Panel>
  );
}

function DatasetsPage({ datasets }: { datasets: Dataset[] }) {
  return (
    <Panel title="Registered satellite and environmental datasets" eyebrow="CATALOG STATUS">
      {datasets.length ? <AdminTable label="Satellite data catalog">
        <thead><tr><th>Dataset</th><th>Product</th><th>Scale</th><th>Classification</th><th>Status</th><th>Description</th></tr></thead>
        <tbody>{datasets.map((dataset, index) => <tr key={dataset.dataset_id ?? `${dataset.name}-${index}`}><td>{dataset.name}</td><td>{dataset.product}</td><td>{dataset.scale}</td><td>{dataset.classification ?? "—"}</td><td><Status value={dataset.status} /></td><td>{dataset.description}</td></tr>)}</tbody>
      </AdminTable> : <Empty>No dataset catalog records are available.</Empty>}
      <p className="admin-footnote">This endpoint provides catalog metadata only. Ingestion, retries, missing-observation reports, and quality-screening controls are not connected.</p>
    </Panel>
  );
}

function ReportsPage({
  reports,
  users,
  onMutate,
}: {
  reports: CommunityReport[];
  users: AdminUser[];
  onMutate: (action: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const statusOptions: CommunityReport["status"][] = ["PENDING", "UNDER_REVIEW", "ACTION_PLANNED", "RESOLVED", "REJECTED"];
  const update = (report: CommunityReport, changes: Record<string, unknown>, description: string) => {
    if (!window.confirm(`${description} for "${report.title}"?`)) return;
    void onMutate(
      () => api(`/admin/reports/${encodeURIComponent(report.id)}`, "PATCH", changes),
      "Community report updated.",
    );
  };
  return (
    <Panel title="Moderation and assignment queue" eyebrow="COMMUNITY REPORTS">
      {reports.length ? <AdminTable label="Community reports">
        <thead><tr><th>Report</th><th>Jurisdiction</th><th>Status</th><th>Assigned to</th><th>Submitted</th></tr></thead>
        <tbody>{reports.map((report) => {
          const eligible = users.filter((user) =>
            ["LGU", "RESEARCHER"].includes(user.role) &&
            user.status === "ACTIVE" &&
            user.jurisdiction_id === report.jurisdiction_id,
          );
          return <tr key={report.id}>
            <td><strong>{report.title}</strong><small>{report.description}</small></td>
            <td>{report.jurisdiction_id}</td>
            <td><select aria-label={`Status for ${report.title}`} value={report.status} onChange={(event) => update(report, { status: event.currentTarget.value }, "Change report status")}>{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></td>
            <td><select aria-label={`Assignee for ${report.title}`} value={report.assigned_to ?? ""} onChange={(event) => update(report, { assigned_to: event.currentTarget.value || null }, "Reassign report")}><option value="">Unassigned</option>{eligible.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></td>
            <td>{formatDate(report.created_at)}</td>
          </tr>;
        })}</tbody>
      </AdminTable> : <Empty>No reports are awaiting moderation.</Empty>}
      <p className="admin-footnote">Report actions are limited to statuses and assignments supported by the backend. Case closure and escalation workflows are not connected.</p>
    </Panel>
  );
}

function PublicationsPage({ publications }: { publications: Publication[] }) {
  return (
    <Panel title="Public research summaries" eyebrow="PUBLICATION RECORDS">
      {publications.length ? <AdminTable label="Research publications">
        <thead><tr><th>Title</th><th>Jurisdiction</th><th>Summary</th><th>Published</th><th>Link</th></tr></thead>
        <tbody>{publications.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.jurisdiction_id ?? "Public"}</td><td>{item.summary || "—"}</td><td>{formatDate(item.published_at)}</td><td><a href={item.url} target="_blank" rel="noreferrer">Open source</a></td></tr>)}</tbody>
      </AdminTable> : <Empty>No public research records are available.</Empty>}
      <p className="admin-footnote">The API does not expose scientific-review approval or publication visibility controls, so this page is read-only. Administrators cannot approve scientific conclusions here.</p>
    </Panel>
  );
}

function MonitoringPage({
  health,
  dashboard,
}: {
  health?: Health;
  dashboard?: AdminDashboard;
}) {
  const checks = [
    ["API service", health?.service ?? "Not reported"],
    ["Authentication / database configuration", health?.databaseStatus ?? "Not reported"],
    ["Database reachability", health?.databaseReachable === null || health?.databaseReachable === undefined ? "Not checked" : health.databaseReachable ? "Reachable" : "Unavailable"],
    ["Satellite processing jobs", "Not reported by backend"],
    ["Failed background jobs", dashboard?.metrics.failedJobs ?? "Not reported"],
    ["Storage and backups", "Not reported by backend"],
  ];
  return (
    <Panel title="Connected service health" eyebrow="LIVE HEALTH ENDPOINT">
      <AdminTable label="System health checks">
        <thead><tr><th>Service</th><th>Reported state</th></tr></thead>
        <tbody>{checks.map(([name, value]) => <tr key={name}><td>{name}</td><td>{value}</td></tr>)}</tbody>
      </AdminTable>
      <p className="admin-footnote">Only values returned by the health and dashboard APIs are shown; unimplemented infrastructure checks are explicitly marked.</p>
    </Panel>
  );
}

function AuditPage({ logs }: { logs: AuditLog[] }) {
  return (
    <Panel title="Recent administrative changes" eyebrow="IMMUTABLE AUDIT RECORDS">
      {logs.length ? <AdminTable label="Audit logs">
        <thead><tr><th>Action</th><th>Resource</th><th>Resource ID</th><th>Actor</th><th>Timestamp</th></tr></thead>
        <tbody>{logs.map((log) => <tr key={log.id}><td>{log.action}</td><td>{log.resource_type}</td><td>{log.resource_id ?? "—"}</td><td>{log.actor_id ?? "System"}</td><td>{formatDate(log.created_at)}</td></tr>)}</tbody>
      </AdminTable> : <Empty>No audit records are available.</Empty>}
    </Panel>
  );
}
