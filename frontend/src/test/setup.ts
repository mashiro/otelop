import { cleanup } from "@testing-library/react";
import { queryClient } from "@/lib/query-client";
import { Storage } from "happy-dom";
import { afterEach, beforeEach, vi } from "vite-plus/test";

// Node's native localStorage can shadow happy-dom's implementation without
// --localstorage-file. Use a browser-like store for persistence tests.
vi.stubGlobal("localStorage", new Storage());
beforeEach(() => vi.stubGlobal("localStorage", new Storage()));

beforeEach(() => queryClient.clear());

// Store/component unit tests isolate navigation from route loaders. Router
// integration tests unmock this boundary and exercise real history instead.
vi.mock("@/lib/navigation-driver", () => ({
  configureNavigation: vi.fn(),
  navigateLocation: (href: string) => window.history.pushState(null, "", href),
}));

afterEach(() => {
  cleanup();
  queryClient.clear();
});
