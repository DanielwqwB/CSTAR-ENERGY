import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { AIAnalyticsChecklist } from "../src/components/AIAnalyticsChecklist";

afterEach(cleanup);

it("updates AI Analytics counts as checklist items are checked and unchecked", async () => {
  const user = userEvent.setup();
  render(<AIAnalyticsChecklist />);
  const checklist = screen.getByRole("region", { name: "AI Analytics checklist" });
  const total = within(checklist).getByRole("status");
  const model = within(checklist).getByRole("checkbox", { name: /ST-GNN/ });

  expect(total.textContent).toBe("3 / 8 checked");
  await user.click(model);
  expect(model.checked).toBe(true);
  expect(total.textContent).toBe("4 / 8 checked");
  await user.click(model);
  expect(model.checked).toBe(false);
  expect(total.textContent).toBe("3 / 8 checked");
});
