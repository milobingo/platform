# UID 1001 is a native CI runner on this VPS. Keep the worker isolated.
FROM livekit/egress:v1.15.0@sha256:ac244a40268ce1dd1510fbff6eb529609ec68aceff1602343f79be8ca08c355b
USER root
RUN usermod --uid 63001 egress && chown -R 63001:0 /home/egress
USER 63001:0
