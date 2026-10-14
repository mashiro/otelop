import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { KVSection } from "./kv-section";

describe("KVSection", () => {
  it("can collapse and reopen attributes without losing their values", async () => {
    render(<KVSection title="Attributes" data={{ method: "POST", retries: 0 }} />);
    const trigger = screen.getByRole("button", { name: "Attributes 2" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText("POST")).toBeTruthy());
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("renders structured values without losing their type and filters the original value", () => {
    const filter = vi.fn();
    const value = { enabled: false, regions: ["jp", "us"] };
    const { rerender } = render(<KVSection title="Resource" data={{ config: value }} />);
    expect(screen.getByText(JSON.stringify(value))).toBeTruthy();
    rerender(<KVSection title="Resource" data={{ config: value }} onFilter={filter} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter where present resource.config" }));
    expect(filter).toHaveBeenCalledWith("config", value);
  });

  it("expands long values with an accessible disclosure", () => {
    const value = "long attribute ".repeat(20);
    render(<KVSection title="Attributes" data={{ message: value }} />);
    const button = screen.getByRole("button", { name: "Show more message" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(
      screen.getByRole("button", { name: "Show less message" }).getAttribute("aria-expanded"),
    ).toBe("true");
  });
});

it("does not clip short multiline attributes without a disclosure", () => {
  render(<KVSection title="Attributes" data={{ message: "first\nsecond\nthird" }} />);
  const value = screen.getByText("first second third");
  expect(value.classList.contains("line-clamp-2")).toBe(false);
  expect(screen.queryByRole("button", { name: "Show more message" })).toBeNull();
});
