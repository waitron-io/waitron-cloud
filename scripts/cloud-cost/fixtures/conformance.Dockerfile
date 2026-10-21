FROM axllent/mailpit:v1.31.1 AS mailpit
FROM node:26.11.1-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql postgresql-client haproxy openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && for binary in initdb postgres; do ln -s /usr/lib/postgresql/*/bin/$binary /usr/local/bin/$binary; done
ARG FIXTURE_UID
ARG FIXTURE_GID
RUN getent group "$FIXTURE_GID" || groupadd -g "$FIXTURE_GID" fixture; \
  getent passwd "$FIXTURE_UID" || useradd -M -u "$FIXTURE_UID" -g "$FIXTURE_GID" fixture
COPY --from=mailpit /mailpit /usr/local/bin/mailpit
COPY weed /usr/local/bin/weed
COPY sdk /app/packages/backups
