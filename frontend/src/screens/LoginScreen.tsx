import { useEffect, useState } from "react";
import {
  Brand,
  Field,
  Icon,
  Toggle,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { useViewport } from "../hooks/useViewport";
import { colors, ui } from "../theme";

export function LoginScreen() {
  const { login, signup } = useWorkspace();
  const { width } = useViewport();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.has("access_token") || params.has("error_description")) {
      if (params.has("error_description"))
        setError(
          "The confirmation link is invalid or expired. Try signing in or request a new link.",
        );
      else
        setMessage(
          "Email confirmation completed. Sign in to open your workspace.",
        );
      // Account verification is handled by Supabase; establish our cookie session through sign-in.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);
  async function signIn() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (creating) {
        const confirmationRequired = await signup(
          name.trim(),
          email.trim(),
          password,
          remember,
        );
        if (confirmationRequired) {
          setMessage("Check your inbox for a confirmation link, then sign in.");
          setCreating(false);
          setPassword("");
          setConfirmPassword("");
        }
        return;
      }
      await login(remember, { email: email.trim(), password });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      creating &&
      (!name.trim() || password.length < 8 || password !== confirmPassword)
    ) {
      setError(
        "Enter your name, use at least 8 password characters, and make sure both passwords match.",
      );
      return;
    }
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      password.length < 4
    ) {
      setError("Enter a valid email and a password of at least 4 characters.");
      return;
    }
    setError("");
    void signIn();
  }
  return (
    <main className="login">
      <section className="login-hero">
        <Brand inverse />
        <div className="stack" style={{ gap: 26, maxWidth: 580 }}>
          <span style={{ color: "#9ad0d5", fontSize: 11 }}>
            {" "}
            ✦ NASA SPACE APPS DEMONSTRATION
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: 48,
              color: "#e7efea",
              lineHeight: 1.12,
              fontWeight: 600,
              letterSpacing: -1.7,
            }}
          >
            Beyond monitoring.
            <br />
            <span style={{ color: "#7dd3fc" }}>Understanding change.</span>
          </h1>
          <p
            style={{
              color: "#cbd5e1",
              fontSize: 16,
              lineHeight: 1.75,
              margin: 0,
            }}
          >
            A multi-satellite research workspace for investigating plausible
            causes of persistent lighting, infrastructure, and industrial
            transitions.
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            {[
              ["4", "SYNTHETIC EVENTS"],
              ["5", "EVIDENCE SOURCES"],
              ["CCTF", "TRANSPARENT METHOD"],
            ].map(([value, label]) => (
              <div
                className="stack"
                key={label}
                style={{
                  flex: 1,
                  backgroundColor: "#07111f99",
                  border: "1px solid #ffffff18",
                  padding: 16,
                  borderRadius: 12,
                  gap: 6,
                }}
              >
                <span
                  style={{ fontSize: 23, fontWeight: 600, color: "#e7efea" }}
                >
                  {value}
                </span>
                <span
                  style={{
                    color: "#b8c9c3",
                    fontSize: 9,
                    letterSpacing: 0.6,
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
        <span style={{ ...ui.small, color: "#b8c9c3" }}>
          Photo: Dennis Kummer / Unsplash · Synthetic demonstration data
        </span>
      </section>
      <section className="login-form">
        <form
          onSubmit={submit}
          noValidate
          className="stack"
          style={{ width: "100%", maxWidth: 440, alignSelf: "center", gap: 24 }}
        >
          {width < 1000 && <Brand />}
          <div className="stack" style={{ gap: 14 }}>
            <h2 style={{ fontSize: 32, margin: 0, fontWeight: 600 }}>
              {creating ? "Create your account" : "Welcome back"}
            </h2>
            <span style={ui.muted}>
              {creating
                ? "Join the CSTAR-Energy research workspace."
                : "Sign in to the CSTAR-Energy demonstration workspace."}
            </span>
          </div>
          {creating && (
            <Field
              label="Full name"
              value={name}
              onChange={setName}
              autoComplete="name"
            />
          )}
          <Field
            label="Email address"
            placeholder="you@example.com"
            value={email}
            onChange={setEmail}
            type="email"
            autoComplete="username"
          />
          <div className="stack" style={{ position: "relative" }}>
            <Field
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="Enter your configured account password"
              type={visible ? "text" : "password"}
              autoComplete={creating ? "new-password" : "current-password"}
              style={{ paddingRight: 50 }}
            />
            <button
              type="button"
              aria-label={visible ? "Hide password" : "Show password"}
              onClick={() => setVisible(!visible)}
              style={{ position: "absolute", right: 0, bottom: 0, padding: 14 }}
            >
              <Icon name={visible ? "eye-off-outline" : "eye-outline"} />
            </button>
          </div>
          {creating && (
            <Field
              label="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              type={visible ? "text" : "password"}
              autoComplete="new-password"
            />
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Toggle
                aria-label="Remember this session"
                value={remember}
                onChange={setRemember}
              />
              <span style={ui.small}>Remember this session</span>
            </div>
          </div>
          {error && (
            <span role="alert" style={{ color: colors.rose, fontSize: 12 }}>
              {error}
            </span>
          )}
          {message && (
            <p role="status" style={{ ...ui.text, color: colors.green }}>
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            style={{
              backgroundColor: colors.cyan,
              color: colors.bg,
              padding: 14,
              borderRadius: 8,
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            {busy
              ? "Please wait…"
              : creating
                ? "Create account"
                : "Sign in to workspace →"}
          </button>
          <button
            type="button"
            disabled={busy}
            style={{ color: colors.cyan, textAlign: "center", fontSize: 13 }}
            onClick={() => {
              setCreating(!creating);
              setError("");
              setMessage("");
              setPassword("");
              setConfirmPassword("");
            }}
          >
            {creating
              ? "Already have an account? Sign in"
              : "New here? Sign up"}
          </button>
          <span style={{ ...ui.small, textAlign: "center" }}>
            CSTAR—ENERGY · Multi-satellite transition intelligence
          </span>
        </form>
      </section>
    </main>
  );
}
