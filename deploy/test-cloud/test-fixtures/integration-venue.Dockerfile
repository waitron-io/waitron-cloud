ARG WAITRON_IMAGE
FROM ${WAITRON_IMAGE}
USER root
ARG WITH_STREAM=0
COPY integration-litestream /proof/litestream
COPY integration-litestream-release.mjs integration-litestream-install.mjs /proof/
RUN if [ "$WITH_STREAM" = 1 ]; then node /proof/integration-litestream-install.mjs; fi
COPY integration-venue.mjs /waitron/apps/server/scripts/cloud-test-integration.mjs
COPY integration-control.mjs /proof/integration-control.mjs
COPY integration-renewal.mjs /proof/integration-renewal.mjs
COPY integration-free-remote.mjs /proof/integration-free-remote.mjs
COPY integration-paid-remote-client.mjs /proof/integration-paid-remote-client.mjs
COPY integration-venue-request.mjs /proof/integration-venue-request.mjs
COPY integration-verification-state.mjs /proof/integration-verification-state.mjs
COPY integration-recovery-authority.mjs /proof/integration-recovery-authority.mjs
COPY integration-stream.mjs /proof/integration-stream.mjs
COPY integration-storage-client.mjs /proof/integration-storage-client.mjs
COPY integration-storage-withdrawal.mjs /proof/integration-storage-withdrawal.mjs
COPY integration-snapshot-client.mjs /proof/integration-snapshot-client.mjs
COPY integration-snapshot-exposure.mjs /proof/integration-snapshot-exposure.mjs
COPY integration-transport.mjs /proof/integration-transport.mjs
WORKDIR /waitron/apps/server
RUN --network=none pnpm --dir ../dashboard build
RUN install -d -o 1000 -g 1000 /tmp/cloud-integration-state
USER 1000:1000
ENTRYPOINT ["node", "--import", "tsx", "/waitron/apps/server/scripts/cloud-test-integration.mjs"]
