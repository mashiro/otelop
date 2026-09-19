import { useEffect, useEffectEvent } from "react";

interface UseKeyboardShortcutOptions {
  // A capture-phase window listener always runs before every bubble-phase
  // one, regardless of mount order. Since the handler calls
  // preventDefault(), an enclosing panel's bubble-phase Escape listener then
  // sees the event as already handled — this is how a nested, innermost
  // visible layer (e.g. a sidebar inside a panel that also listens for
  // Escape) wins without needing to coordinate with what encloses it.
  capture?: boolean;
}

export function useKeyboardShortcut(
  key: string,
  action: () => void,
  options?: UseKeyboardShortcutOptions,
) {
  const onShortcut = useEffectEvent(action);
  const capture = options?.capture ?? false;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== key ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        // Printable keys may require Shift on some keyboard layouts.
        (event.shiftKey && key.length !== 1)
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
      ) {
        return;
      }

      // Let Base UI dismiss the topmost popup before handling page shortcuts.
      // Keep exiting popups in this check so one Escape cannot close both layers.
      if (
        Array.from(
          document.querySelectorAll(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]',
          ),
        ).some((popup) => !popup.closest('[hidden], [aria-hidden="true"]'))
      ) {
        return;
      }

      event.preventDefault();
      onShortcut();
    };

    window.addEventListener("keydown", handleKeyDown, capture);
    return () => window.removeEventListener("keydown", handleKeyDown, capture);
  }, [key, capture]);
}
