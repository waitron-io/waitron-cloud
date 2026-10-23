ARG WAITRON_IMAGE
FROM ${WAITRON_IMAGE}
USER root
COPY integration-venue.mjs /waitron/apps/server/scripts/cloud-test-integration.mjs
COPY integration-control.mjs /proof/integration-control.mjs
WORKDIR /waitron/apps/server
RUN --network=none pnpm --dir ../dashboard build
RUN install -d -o 1000 -g 1000 /tmp/cloud-integration-state
USER 1000:1000
ENTRYPOINT ["node", "--import", "tsx", "/waitron/apps/server/scripts/cloud-test-integration.mjs"]
