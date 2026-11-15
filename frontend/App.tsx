import { DataWorkspace } from "./src/components/DataWorkspace";
import { AdminPortal } from "./src/components/AdminPortal";
import { LoginScreen } from "./src/screens/LoginScreen";
import { useWorkspace, WorkspaceProvider } from "./src/context/WorkspaceContext";

function AuthenticatedWorkspace() {
  const { ready, authenticated, account, logout } = useWorkspace();

  if (!ready) {
    return (
      <main className="workspace-stage workspace-state" aria-live="polite">
        <h1>Checking your session</h1>
      </main>
    );
  }

  if (!authenticated) return <LoginScreen />;

  if (window.location.pathname.startsWith("/admin") && account?.role !== "ADMIN") {
    return (
      <main className="workspace-stage workspace-state" role="alert">
        <h1>Access denied</h1>
        <p>Your account does not have administrator access.</p>
        <button type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </main>
    );
  }

  return account?.role === "ADMIN" ? <AdminPortal /> : <DataWorkspace />;
}

export default function App() {
  return (
    <WorkspaceProvider>
      <AuthenticatedWorkspace />
    </WorkspaceProvider>
  );
}
