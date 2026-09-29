# syntax=docker/dockerfile:1.7
FROM node:26
RUN npm install --global pnpm@9.15.0
WORKDIR /waitron
COPY waitron/ ./
RUN --mount=type=secret,id=npm_token,required=true \
    token="$(cat /run/secrets/npm_token)" \
 && printf '//npm.pkg.github.com/:_authToken=%s\n' "$token" > /root/.npmrc \
 && pnpm install --frozen-lockfile \
 && rm /root/.npmrc \
 && pnpm store prune
WORKDIR /verifier
COPY verifier/ ./
USER 1000:1000
ENTRYPOINT ["node", "/verifier/container-entry.mjs"]
