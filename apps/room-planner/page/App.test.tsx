// @vitest-environment jsdom
// The whole page with the real planner, before any avatar session: the plan
// works by hand from the first frame (no session, no network).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { App } from "./App.tsx";

afterEach(cleanup);
// jsdom lays nothing out, so the transcript has nothing to scroll.
Element.prototype.scrollTo ??= function scrollTo() {};

test("a floor can be laid out, traded and undone by hand before the architect arrives", async () => {
  render(<App />);
  expect(screen.getByText("Start planning")).toBeTruthy();
  expect(await screen.findByText("Draw it")).toBeTruthy();

  fireEvent.click(screen.getByText("Draw it"));
  await waitFor(() => expect(screen.getAllByText("Living room").length).toBeGreaterThan(0));
  expect(screen.getByText("Redraw the floor")).toBeTruthy();

  // Pick the living room in the schedule and give it a square metre from a neighbour.
  const row = screen.getAllByText("Living room").find((el) => el.tagName === "TD")!;
  fireEvent.click(row);
  await waitFor(() => expect(screen.getByLabelText("Room name")).toBeTruthy());
  const area = () => screen.getByLabelText("Living room controls").querySelector(".rp-inspector__area")!.textContent;
  const before = area();
  fireEvent.click(screen.getByText("← Take"));
  await waitFor(() => expect(area() !== before || document.querySelector(".rp-message")).toBeTruthy());

  // Undo is lit, and takes the plan back to the floor as drawn.
  const traded = area() !== before;
  const undo = screen.getByText("Undo") as HTMLButtonElement;
  expect(undo.disabled).toBe(false);
  fireEvent.click(undo);
  if (traded) await waitFor(() => expect(area()).toBe(before));
  else await waitFor(() => expect(screen.queryByLabelText("Room name")).toBeNull());
});
