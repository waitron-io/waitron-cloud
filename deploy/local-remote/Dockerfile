FROM node:24-alpine3.23
RUN apk add --no-cache haproxy wireguard-tools iproute2 iptables openssl ca-certificates dnsmasq
WORKDIR /app
COPY packages/remote-access/src ./src
CMD ["node", "src/gateway-cli.ts"]
