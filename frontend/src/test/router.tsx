import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { Provider, getDefaultStore } from "jotai";
import { createContext, useContext, type ReactNode } from "react";
import { createAppRouter } from "@/router";

// Keep the production route tree, search validation and navigation behavior.
// Isolated component tests supply their own UI and API data, so only loaders
// and lazy route components are omitted here.
const Content = createContext<ReactNode>(null);
function TestRoute() {
  return useContext(Content);
}

export async function createTestRouter(href = "/", store = getDefaultStore()) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [href] }), store);
  for (const route of Object.values(router.routesById)) {
    route.options.loader = undefined;
    route.options.component = undefined;
  }
  router.routesById.__root__.options.component = TestRoute;
  await router.load();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Content.Provider value={children}>
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>
    </Content.Provider>
  );
  return { router, wrapper };
}
