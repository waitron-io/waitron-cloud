FROM node:26-alpine3.23
RUN apk add --no-cache haproxy openssl
WORKDIR /app
COPY package.json ./
COPY deploy/local-stack/bootstrap.mjs deploy/local-stack/runtime.mjs deploy/local-stack/lease.mjs ./deploy/local-stack/
COPY deploy/test-cloud/bootstrap.mjs deploy/test-cloud/proxy*.cfg ./deploy/test-cloud/
COPY packages/remote-access/src/manifest.ts packages/remote-access/src/config.ts ./packages/remote-access/src/
