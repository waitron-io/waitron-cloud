FROM node:26
WORKDIR /verifier
COPY packages/backups/src/ ./
RUN mkdir -p /waitron/apps/server/dist/drizzle/core/meta \
 && echo '{}' > /waitron/apps/server/dist/drizzle/core/meta/_journal.json \
 && echo '{"type":"module"}' > /waitron/apps/server/dist/package.json
COPY deploy/backup-verifier/target.json /waitron/apps/server/dist/target.json
COPY packages/backups/test/container-fixture/worker-bundle.mjs /waitron/apps/server/dist/backup-verification.js
COPY packages/backups/test/container-fixture/restore.mjs /waitron/apps/server/dist/fixture-restore.mjs
LABEL cloud.waitron-revision="8eed667ab0586a3144ed7911b57cf50fcb3b0766"
