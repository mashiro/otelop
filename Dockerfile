# DuckDB requires CGO with glibc and libstdc++.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:54df941ed0d06a1bd95ef5e0ce391fd8d9f94b64782dc9a60062727849ee3f97 AS base

FROM base

# Copy the empty home directory to create writable storage without a shell.
COPY --from=base --chown=65532:65532 /home/nonroot /data

ARG TARGETPLATFORM
COPY --chmod=755 $TARGETPLATFORM/otelop /usr/local/bin/otelop

ENV HOME=/home/nonroot \
    OTELOP_STORAGE_PATH=/data/otelop.duckdb \
    # otelop's default HTTP bind is loopback-only (no auth on the
    # GraphQL/UI endpoint), but Docker's own network namespace already
    # isolates the container — `docker run -p` is the explicit opt-in — so
    # bind all interfaces here or the published port would be unreachable.
    OTELOP_HTTP=0.0.0.0:4319

USER nonroot:nonroot

EXPOSE 4317 4318 4319

ENTRYPOINT ["/usr/local/bin/otelop"]
CMD ["start", "--foreground"]
