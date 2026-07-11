# CGO is required by the DuckDB storage driver (see
# docs/design/duckdb-storage.md "Build and release impact"), so the binary
# links glibc and libstdc++ dynamically (verified locally: `otool -L` on the
# darwin build shows libc++; the linux equivalent is libstdc++.so.6 +
# libgcc_s.so.1). distroless/static and distroless/base ship neither
# libstdc++ nor a C++ runtime, so this moved off distroless to a glibc base
# with libstdc++ installed explicitly.
FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 65532 nonroot \
    && useradd --uid 65532 --gid nonroot --no-create-home --shell /usr/sbin/nologin nonroot

ARG TARGETPLATFORM
COPY $TARGETPLATFORM/otelop /usr/local/bin/otelop

USER nonroot:nonroot

EXPOSE 4317 4318 4319

ENTRYPOINT ["/usr/local/bin/otelop"]
CMD ["start", "--foreground"]
