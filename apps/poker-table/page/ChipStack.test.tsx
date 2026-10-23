// @vitest-environment jsdom
/**
 * CODE-2: the compact modifier must be space-separated from the base class so
 * both selectors apply (regression guard for the migration quote-rewrite that
 * dropped the leading space inside the class-name ternary).
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChipStack } from "./ChipStack.tsx";

afterEach(() => {
  cleanup();
});

describe("ChipStack class name (CODE-2)", () => {
  it("renders 'chip-group chip-group--compact' when compact", () => {
    const { container } = render(<ChipStack amount={100} compact />);
    const group = container.querySelector(".chip-group");
    expect(group).not.toBeNull();
    expect(group!.className).toBe("chip-group chip-group--compact");
  });

  it("renders just 'chip-group' when not compact", () => {
    const { container } = render(<ChipStack amount={100} />);
    expect(container.querySelector(".chip-group")!.className).toBe(
      "chip-group",
    );
  });
});
