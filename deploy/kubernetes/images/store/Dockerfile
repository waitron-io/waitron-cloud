FROM golang:1.24.8-bookworm@sha256:4ed690d6649d63c312b99a6120025ec79ce3b542968a37da53d6236c7c61a848 AS build
ENV GOTOOLCHAIN=local CGO_ENABLED=0
WORKDIR /src
RUN git init && git fetch --depth 1 https://github.com/minio/minio.git refs/tags/RELEASE.2025-10-15T17-29-55Z \
    && test "$(git rev-parse FETCH_HEAD^{commit})" = 9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a \
    && git checkout --detach FETCH_HEAD
ARG WAITRON_GRANT_TIMING=0
COPY grant-timing.patch /grant-timing.patch
RUN if [ "$WAITRON_GRANT_TIMING" = 1 ]; then git apply /grant-timing.patch; fi
RUN go build -trimpath -ldflags "-s -w" -o /minio .

FROM scratch
COPY --from=build /minio /minio
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
USER 10001:10001
ENTRYPOINT ["/minio"]
