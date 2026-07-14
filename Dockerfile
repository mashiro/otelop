FROM gcr.io/distroless/static-debian13:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6

ARG TARGETPLATFORM
COPY $TARGETPLATFORM/otelop /usr/local/bin/otelop

EXPOSE 4317 4318 4319

ENTRYPOINT ["/usr/local/bin/otelop"]
CMD ["start", "--foreground"]
