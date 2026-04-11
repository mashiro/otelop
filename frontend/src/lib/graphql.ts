import { GraphQLClient } from "graphql-request";

// graphql-request parses the endpoint eagerly via `new URL(...)`, which
// rejects bare paths — so we have to anchor the path to the current origin.
// In dev the origin is the Vite server, which proxies /graphql to :4319; in
// production the bundle is served from otelop itself.
export const gqlClient = new GraphQLClient(`${window.location.origin}/graphql`);
