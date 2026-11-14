import { useState } from "react";
import {
  Badge,
  Brand,
  Button,
  Field,
  Icon,
  Notice,
  Toggle,
} from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { useViewport } from "../hooks/useViewport";
import { colors, ui } from "../theme";

export function LoginScreen() {
  const { login } = useWorkspace();
  const { width } = useViewport();
  const [email, setEmail] = useState("analyst@cstar.demo");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState("");
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      password.length < 4
    ) {
      setError(
        "Enter a valid email and a demo password of at least 4 characters.",
      );
      return;
    }
    setError("");
    login(remember);
  }
  return (
    <main className="login">
      <section className="login-hero">
        <Brand />
        <div className="stack" style={{ gap: 26, maxWidth: 580 }}>
          <Badge>✦ NASA SPACE APPS DEMONSTRATION</Badge>
          <h1
            style={{
              margin: 0,
              fontSize: 48,
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
                <span style={{ fontSize: 23, fontWeight: 600 }}>{value}</span>
                <span
                  style={{
                    color: colors.muted,
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
        <span style={ui.small}>
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
            <Badge tone="amber">◇ RESEARCH PROTOTYPE</Badge>
            <h2 style={{ fontSize: 32, margin: 0, fontWeight: 600 }}>
              Welcome back
            </h2>
            <span style={ui.muted}>
              Sign in to the CSTAR-Energy demonstration workspace.
            </span>
          </div>
          <Field
            label="Email address"
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
              placeholder="Use any 4+ characters"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
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
                aria-label="Remember this demo session"
                value={remember}
                onChange={setRemember}
              />
              <span style={ui.small}>Remember this session</span>
            </div>
            <button
              type="button"
              onClick={() => setHelp(!help)}
              style={{ color: colors.cyan, fontSize: 12 }}
            >
              Demo access help
            </button>
          </div>
          {help && (
            <Notice>
              Use any valid email and any password with 4 or more characters, or
              choose Open demo workspace. No credentials are sent or stored.
            </Notice>
          )}
          {error && (
            <span role="alert" style={{ color: colors.rose, fontSize: 12 }}>
              {error}
            </span>
          )}
          <button
            type="submit"
            style={{
              backgroundColor: colors.cyan,
              color: colors.bg,
              padding: 14,
              borderRadius: 8,
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            Sign in to workspace →
          </button>
          <span style={{ ...ui.small, textAlign: "center" }}>
            OR EXPLORE THE PROTOTYPE
          </span>
          <Button
            label="Open demo workspace"
            secondary
            icon="play-outline"
            onClick={() => login(remember)}
          />
          <Notice warning>
            Research demonstration only. All events and satellite observations
            are synthetic. No live satellite feeds or secure authentication are
            connected.
          </Notice>
          <span style={{ ...ui.small, textAlign: "center" }}>
            CSTAR—ENERGY · Multi-satellite transition intelligence
          </span>
        </form>
      </section>
    </main>
  );
}
