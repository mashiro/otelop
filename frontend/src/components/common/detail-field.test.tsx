import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Section } from "./detail-field";

describe("Section", () => {
  it("makes overview collapsible by default", async () => {
    render(<Section title="Overview">Service details</Section>);
    const trigger = screen.getByRole("button", { name: "Overview" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Service details")).toBeTruthy();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByText("Service details")).toBeNull());
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("Service details")).toBeTruthy();
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

  it("supports an initially expanded disclosure with a count", async () => {
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
    await waitFor(() => expect(screen.queryByText("Values")).toBeNull());
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("Values")).toBeTruthy();
  });
});
