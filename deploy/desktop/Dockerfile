# Pinned Coke Dots Linux desktop image; no credentials or user data are copied.
FROM coke-dots-linux-desktop:sha-c4caa5bb8dab2c9f731e4c2f1a71b25266469cfc
USER root
RUN mkdir -p /opt/coke-grok
COPY --chmod=0755 deploy/desktop/start-desktop.sh /usr/local/bin/start-grok-desktop
COPY --chmod=0644 deploy/desktop/agent-runtime.mjs /opt/coke-grok/agent-runtime.mjs
COPY --chmod=0644 deploy/desktop/cloud-kernel-adapter.mjs /opt/coke-dots/grok-kernel-adapter.mjs
USER 1000:1000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/start-grok-desktop"]
