FROM node:26
RUN npm install --global pnpm@9.15.0
WORKDIR /waitron
COPY waitron/ ./
RUN --mount=type=secret,id=npm_token,required=true \
    token="$(cat /run/secrets/npm_token)" \
 && printf '//npm.pkg.github.com/:_authToken=%s\n' "$token" > /root/.npmrc \
 && pnpm install --frozen-lockfile \
 && rm /root/.npmrc \
 && pnpm --dir apps/server build \
 && pnpm store prune
WORKDIR /verifier
COPY verifier/ ./
RUN node --input-type=module -e "import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {currentBackupVerificationTarget} from '/waitron/apps/server/dist/backup-verification.js';assert.deepEqual(currentBackupVerificationTarget(),JSON.parse(await readFile('/verifier/target.json','utf8')));"
USER 1000:1000
ENTRYPOINT ["node", "/verifier/container-entry.mjs"]
