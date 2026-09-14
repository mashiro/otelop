import { cleanup } from "@testing-library/react";
import { queryClient } from "@/lib/query-client";
import { Storage } from "happy-dom";
import { afterEach, beforeEach, vi } from "vite-plus/test";

// Node's native localStorage can shadow happy-dom's implementation without
// --localstorage-file. Use a browser-like store for persistence tests.
vi.stubGlobal("localStorage", new Storage());
beforeEach(() => vi.stubGlobal("localStorage", new Storage()));

beforeEach(() => queryClient.clear());

afterEach(() => {
  cleanup();
  queryClient.clear();
});
