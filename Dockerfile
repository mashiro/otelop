FROM gcr.io/distroless/static-debian13:nonroot

ARG TARGETPLATFORM
COPY $TARGETPLATFORM/otelop /usr/local/bin/otelop

EXPOSE 4317 4318 4319

ENTRYPOINT ["/usr/local/bin/otelop"]
CMD ["start", "--foreground"]
