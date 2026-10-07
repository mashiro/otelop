import { CombinedError } from "@urql/core";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { parse } from "graphql";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vite-plus/test";
import { gqlClient } from "./graphql";

const document = parse("query Lookup($id: ID!) { item(id: $id) { id } }") as TypedDocumentNode<
  { item: { id: string } },
  { id: string }
>;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("GraphQL transport", () => {
  it("posts typed documents and variables and returns fresh data on each request", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: { item: { id: "first" } } }))
      .mockResolvedValueOnce(Response.json({ data: { item: { id: "second" } } }));
    const first = await gqlClient.request(document, { id: "1" });
    expectTypeOf(first).toEqualTypeOf<{ item: { id: string } }>();
    expect(first).toEqual({ item: { id: "first" } });
    expect(await gqlClient.request(document, { id: "1" })).toEqual({ item: { id: "second" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${window.location.origin}/graphql`);
    expect(options?.method).toBe("POST");
    expect(JSON.parse(options?.body as string)).toMatchObject({
      operationName: "Lookup",
      variables: { id: "1" },
    });
  });

  it("rejects GraphQL errors even when partial data is returned", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: { item: null },
        errors: [{ message: "Lookup failed" }],
      }),
    );
    await expect(gqlClient.request(document, { id: "1" })).rejects.toBeInstanceOf(CombinedError);
  });

  it("rejects HTTP and network failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(gqlClient.request(document, { id: "1" })).rejects.toBeInstanceOf(CombinedError);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(gqlClient.request(document, { id: "1" })).rejects.toThrow("offline");
  });

  it("rejects responses without data", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}));
    await expect(gqlClient.request(document, { id: "1" })).rejects.toThrow();
  });

  it("aborts an in-flight fetch and rejects the request", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        }),
    );
    const request = gqlClient.request({
      document,
      variables: { id: "1" },
      signal: controller.signal,
    });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejection;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("does not fetch when the caller has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      gqlClient.request({ document, variables: { id: "1" }, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a shared request alive when only one consumer aborts", async () => {
    const controller = new AbortController();
    let respond!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const cancelled = gqlClient.request({
      document,
      variables: { id: "1" },
      signal: controller.signal,
    });
    const rejection = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    const remaining = gqlClient.request(document, { id: "1" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejection;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    respond(Response.json({ data: { item: { id: "1" } } }));
    await expect(remaining).resolves.toEqual({ item: { id: "1" } });
  });

  it("accepts operations with no variables", async () => {
    const noVariables = parse("query Status { status }") as TypedDocumentNode<
      { status: string },
      Record<string, never>
    >;
    fetchMock.mockResolvedValueOnce(Response.json({ data: { status: "ok" } }));
    await expect(gqlClient.request(noVariables)).resolves.toEqual({ status: "ok" });
  });
});
