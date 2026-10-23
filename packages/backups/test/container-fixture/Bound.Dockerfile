FROM node:26
WORKDIR /verifier
COPY packages/backups/src/ ./
RUN mkdir -p /waitron/apps/server/dist/drizzle/core/meta \
 && echo '{}' > /waitron/apps/server/dist/drizzle/core/meta/_journal.json \
 && echo '{"type":"module"}' > /waitron/apps/server/dist/package.json
COPY packages/backups/test/fixtures/verification-vector.json /tmp/vector.json
RUN node -e "const fs=require('fs');fs.writeFileSync('/waitron/apps/server/dist/target.json',JSON.stringify(JSON.parse(fs.readFileSync('/tmp/vector.json')).target));fs.unlinkSync('/tmp/vector.json');"
COPY packages/backups/test/container-fixture/bound-bundle.mjs /waitron/apps/server/dist/backup-verification.js
