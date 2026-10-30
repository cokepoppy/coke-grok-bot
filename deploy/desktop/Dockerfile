# Pinned Coke Dots Linux desktop image; no credentials or user data are copied.
FROM coke-dots-linux-desktop:sha-c4caa5bb8dab2c9f731e4c2f1a71b25266469cfc
USER root
RUN mkdir -p /opt/coke-grok
COPY --chmod=0755 deploy/desktop/start-desktop.sh /usr/local/bin/start-grok-desktop
COPY --chmod=0644 deploy/desktop/agent-runtime.mjs /opt/coke-grok/agent-runtime.mjs
COPY --chmod=0644 deploy/desktop/cloud-kernel-adapter.mjs /opt/coke-dots/grok-kernel-adapter.mjs
COPY --chmod=0644 deploy/desktop/computer-worker.mjs /opt/coke-dots/grok-computer-worker.mjs
COPY --chmod=0644 deploy/desktop/guarded-computer.mjs /opt/coke-grok/guarded-computer.mjs
COPY deploy/desktop/dsh-runtime/package.json deploy/desktop/dsh-runtime/package-lock.json /opt/coke-grok/dsh-runtime/
RUN npm ci --prefix /opt/coke-grok/dsh-runtime --omit=dev --no-audit --no-fund \
    && test "$(/opt/coke-grok/dsh-runtime/node_modules/.bin/dsh --version)" = "0.2.1-rc.5" \
    && mkdir -p /opt/coke-dots/node_modules/@deepseek-ai \
    && rm -rf /opt/coke-dots/node_modules/@deepseek-ai/dsh-sdk-client \
    && ln -s /opt/coke-grok/dsh-runtime/node_modules/@deepseek-ai/dsh-sdk-client /opt/coke-dots/node_modules/@deepseek-ai/dsh-sdk-client \
    && cd /opt/coke-grok/dsh-runtime && node --input-type=module -e 'console.log(import.meta.resolve("@deepseek-ai/dsh-sdk-client"))'
ENV DOTS_DSH_BIN=/opt/coke-grok/dsh-runtime/node_modules/.bin/dsh
USER 1000:1000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/start-grok-desktop"]
