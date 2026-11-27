#!/usr/bin/env bash
set -euo pipefail

# Match the isolated launcher's random loopback port without printing its connection URL.
port=${TEST_DATABASE_URL%/cloud_test}
port=${port##*:}
[[ $port =~ ^[0-9]+$ ]]
container=$(timeout 5s docker ps --filter name=waitron-cloud-test- --format '{{.Names}} {{.Ports}}' |
  awk -v port="127.0.0.1:$port->5432/tcp" '$2 == port {print $1}')
[[ $container =~ ^waitron-cloud-test-[0-9a-f-]+$ ]]
psql=(docker exec -i -e PGAPPNAME=d530-sampler -e 'PGOPTIONS=-c statement_timeout=750ms'
  "$container" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d cloud_test)

printf 'D530 setup at %s; available CPUs=%s\n' "$(date -u +%FT%T.%3NZ)" "$(nproc)"
node -e 'console.log({node:process.version, availableParallelism:require("node:os").availableParallelism()})'
timeout 5s "${psql[@]}" -c "ALTER SYSTEM SET track_wal_io_timing = on" -c "SELECT pg_reload_conf()"
data_directory=$(timeout 5s "${psql[@]}" -c 'SHOW data_directory')
mount=$(timeout 5s docker inspect -f '{{range .Mounts}}{{println .Source .Destination}}{{end}}' "$container")
printf 'D530 database directory and Docker mounts\n%s\n%s\n' "$data_directory" "$mount"
timeout 5s docker exec "$container" sh -ec 'readlink -f "$1/pg_wal"; df -T "$1" "$1/pg_wal"' sh "$data_directory"
while read -r source destination; do
  if [[ -n $source && $data_directory == "$destination"* ]]; then
    timeout 5s sudo -n findmnt -T "$source" -o TARGET,SOURCE,FSTYPE,MAJ:MIN || printf 'D530 host mount lookup failed (%s)\n' "$?"
  fi
done <<< "$mount"
timeout 5s docker inspect -f 'D530 database image {{.Image}}' "$container"
timeout 5s "${psql[@]}" -c "SELECT json_object_agg(name, setting) FROM pg_settings
  WHERE name IN ('server_version', 'fsync', 'synchronous_commit', 'full_page_writes', 'wal_sync_method', 'track_wal_io_timing')"

timeout 420s "${psql[@]}" <<'SQL' &
SELECT json_build_object(
  'event', 'd530-db', 'at', clock_timestamp(),
  'activity', (SELECT json_agg(a) FROM (
    SELECT pid, backend_type, application_name, state, wait_event_type, wait_event
    FROM pg_stat_activity WHERE pid <> pg_backend_pid()
      AND (backend_type <> 'client backend' OR state = 'active')
    ORDER BY pid LIMIT 80
  ) a),
  'wal_io', (SELECT json_agg(io) FROM (
    SELECT backend_type, context, writes, write_time, fsyncs, fsync_time
    FROM pg_stat_io WHERE object = 'wal'
  ) io),
  'checkpointer', (SELECT row_to_json(c) FROM pg_stat_checkpointer c)
)
\watch interval=0.5 count=840
SQL
db_sampler=$!

timeout 420s bash -c '
  while :; do
    printf "D530 runner %s\n" "$(date -u +%FT%T.%3NZ)"
    awk "{print FILENAME, \$0}" /proc/pressure/cpu /proc/pressure/io
    awk "\$3 !~ /^(loop|ram)/ {print \"disk\",\$0}" /proc/diskstats
    ps -eo comm,args | awk "\$1 == \"node\" && NF == 3 && \$3 ~ /^test\\/.*\\.test\\.ts\$/ {workers++; if (\$3 ~ /(relay-grants|ses-feedback-bounds)/) print \"fixture worker\",\$3} END {print \"file workers\",workers+0}"
    sleep 2
  done
' &
host_sampler=$!

cleanup() {
  for sampler in "$db_sampler" "$host_sampler"; do
    if kill -0 "$sampler" 2>/dev/null; then
      kill "$sampler" 2>/dev/null || true
      wait "$sampler" 2>/dev/null || true
    else
      wait "$sampler" || printf 'D530 sampler exited early (%s)\n' "$?"
    fi
  done
}
trap cleanup EXIT

printf 'D530 shard start at %s\n' "$(date -u +%FT%T.%3NZ)"
result=0
pnpm --filter @waitron-cloud/registration exec node ../../scripts/ci-run-registration-shard.mjs 5 || result=$?
printf 'D530 shard exit %s at %s\n' "$result" "$(date -u +%FT%T.%3NZ)"
exit "$result"
