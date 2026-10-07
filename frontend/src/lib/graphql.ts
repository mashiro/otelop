import { Client, fetchExchange } from "@urql/core";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";

const client = new Client({
  url: `${window.location.origin}/graphql`,
  // TanStack Query owns caching and refreshes; transport results must be fresh.
  exchanges: [fetchExchange],
  requestPolicy: "network-only",
  preferGetMethod: false,
});

type Variables = Record<string, unknown>;
type RequestOptions<Data, Vars extends Variables> = {
  document: TypedDocumentNode<Data, Vars>;
  variables: Vars;
  signal?: AbortSignal;
};

function request<Data, Vars extends Variables>(
  document: TypedDocumentNode<Data, Vars>,
  ...args: {} extends Vars ? [variables?: Vars] : [variables: Vars]
): Promise<Data>;
function request<Data, Vars extends Variables>(options: RequestOptions<Data, Vars>): Promise<Data>;
async function request<Data, Vars extends Variables>(
  input: TypedDocumentNode<Data, Vars> | RequestOptions<Data, Vars>,
  variables?: Vars,
): Promise<Data> {
  const options = "document" in input ? input : { document: input, variables };
  const signal = "signal" in options ? options.signal : undefined;
  signal?.throwIfAborted();

  return new Promise<Data>((resolve, reject) => {
    let subscription: { unsubscribe(): void } | undefined;
    const cleanup = () => {
      subscription?.unsubscribe();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      // Unsubscribing tears down urql's fetch without cancelling other consumers.
      cleanup();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    subscription = client
      .query(options.document, (options.variables ?? {}) as Vars)
      .subscribe((result) => {
        if (result.stale || result.hasNext) return;
        // An existing operation can emit synchronously before subscribe returns.
        queueMicrotask(cleanup);
        if (result.error) reject(result.error);
        else if (result.data == null) reject(new Error("GraphQL response did not contain data"));
        else resolve(result.data);
      });
  });
}

export const gqlClient = { request };
