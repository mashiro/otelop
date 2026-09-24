import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";
import { render } from "@testing-library/react";
import { Provider, createStore, useAtomValue } from "jotai";
import type { Theme } from "@/stores/theme";

// themeAtom reads storage when its module is evaluated, so each test seeds
// localStorage first and then imports fresh module instances.
async function loadTheme(stored: Theme) {
  localStorage.setItem("theme", JSON.stringify(stored));
  vi.resetModules();
  const [{ themeAtom }, { useThemeSync }] = await Promise.all([
    import("@/stores/theme"),
    import("./use-theme"),
  ]);
  return { themeAtom, useThemeSync };
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("themeAtom", () => {
  it("starts from the stored theme before any subscriber mounts", async () => {
    const { themeAtom } = await loadTheme("dark");
    expect(createStore().get(themeAtom)).toBe("dark");
  });
});

describe("useThemeSync", () => {
  // Mirrors App → Header: a descendant also reads themeAtom, and descendant
  // effects subscribe (and mount the atom) before the ancestor's do.
  async function renderApp(stored: Theme) {
    const { themeAtom, useThemeSync } = await loadTheme(stored);
    function Child() {
      return <span>{useAtomValue(themeAtom)}</span>;
    }
    function App() {
      useThemeSync();
      return <Child />;
    }
    return render(
      <Provider store={createStore()}>
        <App />
      </Provider>,
    );
  }

  it("keeps the dark class after a reload with the dark theme stored", async () => {
    // The inline script in index.html applies the class before React mounts.
    document.documentElement.classList.add("dark");
    await renderApp("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("leaves the dark class off after a reload with the light theme stored", async () => {
    await renderApp("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
