ARG WAITRON_IMAGE
FROM ${WAITRON_IMAGE}
USER root
ARG WITH_STREAM=0
COPY integration-litestream /proof/litestream
COPY integration-litestream-release.mjs integration-litestream-install.mjs /proof/
RUN if [ "$WITH_STREAM" = 1 ]; then node /proof/integration-litestream-install.mjs; fi
COPY --chmod=0644 integration-venue.mjs /waitron/apps/server/scripts/cloud-test-integration.mjs
COPY --chmod=0644 integration-control.mjs \
    integration-renewal.mjs \
    integration-free-remote.mjs \
    integration-paid-remote-client.mjs \
    integration-venue-request.mjs \
    integration-verification-state.mjs \
    integration-recovery-authority.mjs \
    integration-source-identity.mjs \
    integration-stream.mjs \
    integration-storage-client.mjs \
    integration-storage-withdrawal.mjs \
    integration-snapshot-client.mjs \
    integration-snapshot-exposure.mjs \
    integration-transport.mjs /proof/
WORKDIR /waitron/apps/server
RUN --network=none pnpm --dir ../dashboard build
RUN install -d -o 1000 -g 1000 /tmp/cloud-integration-state
USER 1000:1000
ENTRYPOINT ["node", "--import", "tsx", "/waitron/apps/server/scripts/cloud-test-integration.mjs"]
