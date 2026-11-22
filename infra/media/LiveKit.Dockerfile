# Built only on the external generator by build-livekit.py. No Go build on the
# shared show VPS. The build context contains just this file and the tested binary.
FROM livekit/livekit-server:v1.13.11@sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20
USER 0
ARG MILO_LIVEKIT_BINARY_SHA256
COPY livekit-server /livekit-server
RUN test -n "$MILO_LIVEKIT_BINARY_SHA256" && printf '%s  /livekit-server\n' "$MILO_LIVEKIT_BINARY_SHA256" | sha256sum -c -
LABEL org.opencontainers.image.version="1.13.11" \
      org.opencontainers.image.revision="385aa40f9292fe1db8caad87301e4b285b7c198a" \
      nl.dgwebservices.milo.patch="embedded-turn-configured-tls-port-v1" \
      nl.dgwebservices.milo.binary-sha256="$MILO_LIVEKIT_BINARY_SHA256"
USER 65532:65532
