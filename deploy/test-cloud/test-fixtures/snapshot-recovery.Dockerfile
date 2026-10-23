ARG VERIFIER_IMAGE
FROM ${VERIFIER_IMAGE}
USER root
COPY snapshot-recovery.mjs /waitron/apps/server/scripts/cloud-joint-proof.mjs
WORKDIR /waitron/apps/server
# Compile the unchanged pinned client and restore boundary with Waitron's release/runtime stamps.
RUN pnpm exec node ../../scripts/bundle-node.mjs scripts/cloud-joint-proof.mjs=dist/cloud-joint-proof.js
USER 1000:1000
ENTRYPOINT ["node", "/waitron/apps/server/dist/cloud-joint-proof.js"]
