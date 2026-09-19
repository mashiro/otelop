import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DetailPanel } from "@/components/common/detail-panel";
import { SearchFilter } from "@/components/filters/search-filter";
import { useKeyboardShortcut } from "./use-keyboard-shortcut";

afterEach(cleanup);

function setup() {
  const onClose = vi.fn();
  const onSubmit = vi.fn((value: string) => value);
  const view = render(
    <DetailPanel header="Details" onClose={onClose}>
      <SearchFilter value="original" onSubmit={onSubmit} placeholder="Search logs…" />
      <textarea aria-label="Editor" />
      <div contentEditable aria-label="Editable" />
    </DetailPanel>,
  );
  return { onClose, onSubmit, ...view };
}

describe("page keyboard shortcuts", () => {
  it("closes details with Escape and removes the listener on unmount", () => {
    const { onClose, unmount } = setup();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "focuses search with / (shiftKey=%s) and preserves the draft",
    (shiftKey) => {
      const { onClose, onSubmit } = setup();
      const search = screen.getByRole("textbox", { name: "Search logs…" });
      fireEvent.keyDown(document.body, { key: "/", shiftKey });
      expect(document.activeElement).toBe(search);
      fireEvent.change(search, { target: { value: "unfinished" } });
      fireEvent.keyDown(search, { key: "Escape" });
      expect(document.activeElement).not.toBe(search);
      expect((search as HTMLInputElement).value).toBe("unfinished");
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it("does not treat ? or command-modified slash as the search shortcut", () => {
    setup();
    const search = screen.getByRole("textbox", { name: "Search logs…" });
    for (const options of [
      { key: "?", shiftKey: true },
      { key: "/", shiftKey: true, ctrlKey: true },
      { key: "/", shiftKey: true, metaKey: true },
      { key: "/", shiftKey: true, altKey: true },
    ]) {
      fireEvent.keyDown(document.body, options);
      expect(document.activeElement).not.toBe(search);
    }
  });

  it("ignores editable fields, composition, repeat, modifiers and handled events", () => {
    const { onClose } = setup();
    for (const target of [screen.getByLabelText("Editor"), screen.getByLabelText("Editable")]) {
      fireEvent.keyDown(target, { key: "Escape" });
      fireEvent.keyDown(target, { key: "/" });
    }
    for (const options of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
    ]) {
      fireEvent.keyDown(document.body, { key: "Escape", ...options });
    }
    const handled = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lets a popup consume Escape before closing details", () => {
    const { onClose } = setup();
    const popup = document.createElement("div");
    popup.setAttribute("data-slot", "popover-content");
    document.body.append(popup);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    popup.hidden = true;
    fireEvent.keyDown(document.body, { key: "Escape" });
    popup.remove();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves IME composition in search", () => {
    const { onClose, onSubmit } = setup();
    const search = screen.getByRole("textbox", { name: "Search logs…" });
    search.focus();
    fireEvent.keyDown(search, { key: "Escape", isComposing: true });
    fireEvent.keyDown(search, { key: "Enter", keyCode: 229 });
    expect(document.activeElement).toBe(search);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

function BubbleShortcut({ action }: { action: () => void }) {
  useKeyboardShortcut("Escape", action);
  return null;
}

function CaptureShortcut({ action }: { action: () => void }) {
  useKeyboardShortcut("Escape", action, { capture: true });
  return null;
}

describe("useKeyboardShortcut capture option", () => {
  it("fires only a mounted capture-phase shortcut over a bubble-phase one, then falls back to the bubble one once it unmounts", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { rerender } = render(
      <>
        <BubbleShortcut action={outer} />
        <CaptureShortcut action={inner} />
      </>,
    );

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();

    rerender(<BubbleShortcut action={outer} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
