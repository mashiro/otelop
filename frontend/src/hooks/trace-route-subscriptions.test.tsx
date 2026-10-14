import { parseTraceSearch } from "@/lib/trace-search";
import { act, renderHook } from "@testing-library/react";
import { createStore } from "jotai";
import { expect, it } from "vite-plus/test";
import { createTestRouter } from "@/test/router";
import {
  useSignalQueryActions,
  useSignalQuery,
  useTimeWindow,
  useRelatedSignals,
} from "./use-signal-route";

it("only notifies filter and time consumers when their own URL fields change", async () => {
  const { router, wrapper } = await createTestRouter("/traces/t1/spans/s1?range=6h", createStore());
  let queryRenders = 0;
  let windowRenders = 0;
  let actionRenders = 0;
  renderHook(
    () => {
      queryRenders++;
      return useSignalQuery("traces");
    },
    { wrapper },
  );
  renderHook(
    () => {
      windowRenders++;
      return useTimeWindow();
    },
    { wrapper },
  );
  const actions = renderHook(
    () => {
      actionRenders++;
      return useRelatedSignals();
    },
    { wrapper },
  );
  const before = [queryRenders, windowRenders, actionRenders];
  await act(async () => {
    await router.navigate({
      to: ".",
      search: (previous) => ({ ...previous, spanTab: "links", link: "t1/s1/0" }),
    });
  });
  expect([queryRenders, windowRenders, actionRenders]).toEqual(before);
  await act(async () => {
    await router.navigate({ to: ".", search: (previous) => ({ ...previous, range: "24h" }) });
  });
  expect(queryRenders).toBe(before[0]);
  expect(windowRenders).toBeGreaterThan(before[1]);
  expect(actionRenders).toBe(before[2]);
  await act(async () => {
    await actions.result.current.navigateToLogs("t1");
  });
  expect(router.state.location.search.range).toBe("24h");
});

it("filter commands use the latest URL without subscribing to filter changes", async () => {
  const { router, wrapper } = await createTestRouter("/traces/t1", createStore());
  let renders = 0;
  const { result } = renderHook(
    () => {
      renders++;
      return useSignalQueryActions("traces");
    },
    { wrapper },
  );
  const initial = renders;
  await act(async () => {
    await router.navigate({ to: ".", search: { filter: ["service_name:checkout"] } });
  });
  expect(renders).toBe(initial);
  await act(async () => {
    await result.current.addFilter(parseTraceSearch("name:publish").terms[0]);
  });
  expect(router.state.location.search.filter).toEqual(["service_name:checkout", "name:publish"]);
  expect(renders).toBe(initial);
});
