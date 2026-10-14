import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { Section } from "./detail-field";

describe("Section", () => {
  it("makes overview collapsible by default", () => {
    render(<Section title="Overview">Service details</Section>);
    const trigger = screen.getByRole("button", { name: "Overview" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps header actions separate from the disclosure", () => {
    const onAction = vi.fn();
    render(
      <Section title="Body" action={<button onClick={onAction}>Filter body</button>}>
        Message
      </Section>,
    );
    const trigger = screen.getByRole("button", { name: "Body" });
    const action = screen.getByRole("button", { name: "Filter body" });
    expect(trigger.contains(action)).toBe(false);
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("supports an initially expanded disclosure with a count", () => {
    render(
      <Section title="Attributes" count={2}>
        Values
      </Section>,
    );
    const trigger = screen.getByRole("button", { name: "Attributes 2" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Values")).toBeTruthy();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
