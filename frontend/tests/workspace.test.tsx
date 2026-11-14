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

vi.mock("mapbox-gl", () => ({ default: { supported: () => false } }));

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { value: 1440, writable: true });
});
afterEach(cleanup);
async function openWorkspace() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: "Open demo workspace" }),
  );
  await screen.findByRole("heading", {
    name: "Regional Intelligence Overview",
  });
  return user;
}
describe("browser workspace", () => {
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
  it("filters catalogue rows and saves notes across reloads", async () => {
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
      expect(localStorage.getItem("cstar-workspace-v1")).toContain(
        "Verify the commissioning date.",
      ),
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
