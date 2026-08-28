# CGO is required by the DuckDB storage driver (see
# docs/design/duckdb-storage.md "Build and release impact"), so the binary
# links glibc and libstdc++ dynamically (verified locally: `otool -L` on the
# darwin build shows libc++; the linux equivalent is libstdc++.so.6 +
# libgcc_s.so.1). distroless/static and distroless/base ship neither
# libstdc++ nor a C++ runtime, so this moved off distroless to a glibc base
# with libstdc++ installed explicitly.
FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 65532 nonroot \
    && useradd --uid 65532 --gid nonroot --create-home --shell /usr/sbin/nologin nonroot \
    && install -d -o nonroot -g nonroot /data

ARG TARGETPLATFORM
COPY $TARGETPLATFORM/otelop /usr/local/bin/otelop

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
