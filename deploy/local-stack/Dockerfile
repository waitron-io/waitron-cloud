# syntax=docker/dockerfile:1.7
FROM node:26-alpine3.23 AS storage-tools

ARG SEAWEED_VERSION=4.47
ARG SEAWEED_AMD64_SHA256
ARG SEAWEED_ARM64_SHA256
ARG TARGETARCH

COPY scripts/fixtures/storage-archive-download.mjs /tmp/storage-archive-download.mjs
RUN apk add --no-cache ca-certificates curl docker-cli haproxy iproute2 iptables openssl tar wireguard-tools \
 && case "$TARGETARCH" in \
      amd64) archive=linux_amd64.tar.gz; digest="$SEAWEED_AMD64_SHA256" ;; \
      arm64) archive=linux_arm64.tar.gz; digest="$SEAWEED_ARM64_SHA256" ;; \
      *) echo "Unsupported local-stack architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && test -n "$digest" \
 && node --use-env-proxy /tmp/storage-archive-download.mjs "https://github.com/seaweedfs/seaweedfs/releases/download/${SEAWEED_VERSION}/${archive}" /tmp/weed.tgz \
 && echo "$digest  /tmp/weed.tgz" | sha256sum -c - \
 && tar -xzf /tmp/weed.tgz -C /usr/local/bin weed \
 && rm /tmp/weed.tgz /tmp/storage-archive-download.mjs \
 && npm install --global pnpm@9.15.0

FROM storage-tools
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=npm_token,required=true \
    --mount=type=cache,id=waitron-cloud-pnpm,target=/root/.local/share/pnpm/store \
    token="$(cat /run/secrets/npm_token)" \
 && printf '//npm.pkg.github.com/:_authToken=%s\n' "$token" > /root/.npmrc \
 && pnpm install --frozen-lockfile \
 && pnpm portal:build \
 && pnpm store prune \
 && rm /root/.npmrc

ENV NODE_ENV=development
CMD ["node", "deploy/local-stack/runtime.mjs", "account"]
