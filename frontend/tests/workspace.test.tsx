import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import seed from "../src/data/events.json";
import type { WorkspaceData } from "../src/api";

let saved: WorkspaceData;
let signedIn = false;
beforeEach(() => {
  saved = {
    events: structuredClone(seed) as WorkspaceData["events"],
    region: "Aurelia Pilot Locality",
    records: [],
    profile: { name: "Demo Analyst", email: "analyst@cstar.demo" },
    version: 0,
  };
  signedIn = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      const method = options?.method || "GET";
      const response = (data: unknown, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => structuredClone(data),
      });
      if (path === "/api/session" && method === "POST") {
        signedIn = true;
        return response(saved);
      }
      if (path === "/api/signup" && method === "POST")
        return response({ confirmationRequired: true });
      if (!signedIn) return response({ error: "Sign in to continue" }, 401);
      if (method === "DELETE") {
        signedIn = false;
        return response({ ok: true });
      }
      if (method === "PUT") {
        saved = {
          ...JSON.parse(String(options?.body)),
          version: saved.version + 1,
        };
      }
      return response(saved);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

vi.mock("mapbox-gl", () => ({ default: { supported: () => false } }));

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1440, writable: true });
});
afterEach(cleanup);
async function openWorkspace() {
  const user = userEvent.setup();
  render(<App />);
  await user.type(await screen.findByLabelText('Email address'), 'analyst@example.com');
  await user.type(screen.getByLabelText('Password'), 'test-password');
  await user.click(screen.getByRole('button', { name: /Sign in to workspace/ }));
  await screen.findByRole("heading", {
    name: "Regional Intelligence Overview",
  });
  return user;
}
describe("browser workspace", () => {
  it("validates signup passwords and shows the email confirmation step", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "New here? Sign up" }),
    );
    await user.type(screen.getByLabelText("Full name"), "New Analyst");
    await user.type(screen.getByLabelText("Email address"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "test-password");
    await user.type(
      screen.getByLabelText("Confirm password"),
      "different-password",
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "both passwords match",
    );
    await user.clear(screen.getByLabelText("Confirm password"));
    await user.type(screen.getByLabelText("Confirm password"), "test-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      await screen.findByText(/Check your inbox for a confirmation link/),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(signedIn).toBe(false);
  });
  it("opens the profile, persists edits, and logs out from the profile page", async () => {
    const user = await openWorkspace();
    await user.click(screen.getByRole("button", { name: "View profile" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "My profile" }),
    ).toBeTruthy();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Updated Analyst");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(saved.profile.name).toBe("Updated Analyst"));
    cleanup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "View profile" }),
    );
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Updated Analyst",
    );
    await user.click(
      screen.getByRole("button", { name: "Log out", exact: true }),
    );
    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeTruthy();
    expect(signedIn).toBe(false);
  });
  it("validates demo login and toggles password visibility", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /Sign in to workspace/ }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "at least 4 characters",
    );
    await user.type(screen.getByLabelText("Password"), "demo");
    await user.type(
      screen.getByLabelText("Email address"),
      "analyst@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("text");
    await user.click(
      screen.getByRole("button", { name: /Sign in to workspace/ }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Regional Intelligence Overview",
      }),
    ).toBeTruthy();
  });
  it("opens every workspace section without a runtime error", async () => {
    const user = await openWorkspace();
    const nav = screen.getByRole("navigation");
    for (const name of [
      "Transition Map",
      "Event Catalogue",
      "Event Investigation",
      "Evidence Timeline",
      "Source–Plume",
      "Counterfactual",
      "CCTF Assessment",
      "Data Explorer",
      "Intervention Registry",
      "Research Analytics",
      "Research Alerts",
      "Reports & Exports",
      "Administration",
      "Intelligence Overview",
    ]) {
      await user.click(within(nav).getByRole("button", { name, exact: true }));
      expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    }
  });
  it("filters catalogue rows and saves notes through the API across reloads", async () => {
    const user = await openWorkspace();
    await user.click(
      screen.getByRole("button", { name: "Event Catalogue", exact: true }),
    );
    await user.type(screen.getByPlaceholderText(/Search event ID/), "Eastport");
    expect(screen.getByText("1 of 4 synthetic candidates")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Event Investigation", exact: true }),
    );
    await user.type(
      screen.getByLabelText("Investigation notes"),
      "Verify the commissioning date.",
    );
    await user.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() =>
      expect(
        saved.events.find((event) => event.id === "DEMO-002")?.notes,
      ).toContain("Verify the commissioning date."),
    );
    cleanup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: "Event Investigation",
        exact: true,
      }),
    );
    expect(
      (screen.getByLabelText("Investigation notes") as HTMLTextAreaElement)
        .value,
    ).toBe("Verify the commissioning date.");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeTruthy();
  });
});
