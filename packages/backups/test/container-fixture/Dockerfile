FROM node:26
WORKDIR /verifier
COPY packages/backups/src/verify-process.ts packages/backups/src/waitron-verifier.ts packages/backups/src/waitron-verify-child.mjs packages/backups/src/container-entry.mjs ./
RUN mkdir -p /waitron/apps/server/src /waitron/apps/server/node_modules/tsx \
 && echo '{"type":"module"}' > /waitron/apps/server/package.json \
 && echo '{"name":"tsx","type":"module","exports":"./loader.mjs"}' > /waitron/apps/server/node_modules/tsx/package.json \
 && touch /waitron/apps/server/node_modules/tsx/loader.mjs \
 && echo 'export const ALL_MODULES=[{name:"fake",backup:{restore(){}}}]' > /waitron/apps/server/src/modules.ts
COPY packages/backups/test/container-fixture/restore.mjs /waitron/apps/server/src/restore.ts
ENTRYPOINT ["node","/verifier/container-entry.mjs"]
COPY packages/backups/test/container-fixture/env-file.mjs /waitron/apps/server/src/env-file.ts
