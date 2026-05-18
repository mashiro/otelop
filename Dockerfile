FROM gcr.io/distroless/static-debian13:nonroot@sha256:963fa6c544fe5ce420f1f54fb88b6fb01479f054c8056d0f74cc2c6000df5240

ARG TARGETPLATFORM
COPY $TARGETPLATFORM/otelop /usr/local/bin/otelop

EXPOSE 4317 4318 4319

ENTRYPOINT ["/usr/local/bin/otelop"]
CMD ["start", "--foreground"]
