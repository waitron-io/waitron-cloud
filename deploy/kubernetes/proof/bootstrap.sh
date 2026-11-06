#!/bin/bash
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077
work=''
finish() {
  status=$?
  set +e
  trap - EXIT
  if (( status != 0 )); then
    /usr/bin/timeout 10 /usr/bin/systemctl --no-block poweroff || true
    echo 'D570 deadline unavailable; poweroff requested' >&2
  fi
  if [[ -n "$work" ]]; then rm -rf -- "$work" || true; fi
  exit "$status"
}
trap '' PIPE
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
trap finish EXIT
[[ $(/usr/bin/id -u) == 0 ]] || exit 1
work=$(mktemp -d /run/d570-deadline.XXXXXXXX)
boot=$(cat /proc/sys/kernel/random/boot_id)
[[ "$boot" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$ ]] || exit 1
read -r uptime idle < /proc/uptime
[[ "$uptime" =~ ^[0-9]+\.[0-9]+$ ]] || exit 1
uptime=${uptime%%.*}
(( uptime < 2147483647 )) || exit 1
now=$(/usr/bin/date +%s)
[[ "$now" =~ ^[0-9]{10}$ ]] || exit 1
(( now >= @START@ && now < @EXPIRY@ )) || exit 1
printf '%s\n' '@IDENTITY@' "$boot" > "$work/identity"
state=/var/lib/d570-deadline
# Drop-ins can override the installed deadline even when the main unit is intact.
for unit in d570-deadline.service d570-deadline.timer d570-reboot.service; do
  for directory in /etc/systemd/system.control /run/systemd/system.control /run/systemd/transient /run/systemd/generator.early /etc/systemd/system /etc/systemd/system.attached /run/systemd/system /run/systemd/system.attached /run/systemd/generator /usr/local/lib/systemd/system /usr/lib/systemd/system /lib/systemd/system /run/systemd/generator.late; do
    if [[ "$directory" != /etc/systemd/system ]]; then
      [[ ! -e "$directory/$unit" && ! -L "$directory/$unit" ]] || exit 1
    fi
    for dropin in "$unit.d" service.d timer.d d570-.service.d d570-.timer.d; do
      [[ ! -e "$directory/$dropin" && ! -L "$directory/$dropin" ]] || exit 1
    done
  done
done
if mkdir -m 700 "$state" 2>/dev/null; then
  for unit in d570-deadline.service d570-deadline.timer d570-reboot.service; do
    [[ ! -e "/etc/systemd/system/$unit" && ! -L "/etc/systemd/system/$unit" ]] || exit 1
  done
  # A boot-relative trigger keeps clock rollback from extending the first boot.
  # Reboot shuts down instead of granting a fresh boot-relative interval.
  monotonic=$(( uptime + @EXPIRY@ - now - 2 ))
  (( monotonic > uptime )) || exit 1
  cat > "$work/d570-deadline.service" <<'UNIT'
[Unit]
Description=D570 fixed proof deadline
OnFailure=poweroff.target
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl --no-block poweroff
UNIT
  cat > "$work/d570-reboot.service" <<'UNIT'
[Unit]
Description=D570 refuses a second boot
DefaultDependencies=no
After=local-fs.target
Before=cloud-init-local.service cloud-init.service multi-user.target
OnFailure=poweroff.target
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl --no-block poweroff
[Install]
WantedBy=multi-user.target
UNIT
  cat > "$work/d570-deadline.timer" <<UNIT
[Unit]
Description=D570 original absolute and boot deadline
[Timer]
OnCalendar=@CALENDAR@
OnBootSec=${monotonic}s
AccuracySec=1us
RandomizedDelaySec=0
Persistent=true
Unit=d570-deadline.service
UNIT
  install -m 600 "$work/identity" "$state/identity"
  printf '%s %s\n' "$now" "$monotonic" > "$work/clock"
  install -m 600 "$work/clock" "$state/clock"
  install -m 644 "$work/d570-deadline.service" "$work/d570-deadline.timer" "$work/d570-reboot.service" /etc/systemd/system/
  cksum /etc/systemd/system/d570-deadline.service /etc/systemd/system/d570-deadline.timer /etc/systemd/system/d570-reboot.service "$state/clock" > "$state/units"
  /usr/bin/timeout 10 /usr/bin/systemctl daemon-reload
  /usr/bin/timeout 10 /usr/bin/systemctl enable d570-reboot.service
  /usr/bin/timeout 10 /usr/bin/systemctl start d570-deadline.timer
else
  [[ -d "$state" && ! -L "$state" && -f "$state/ready" ]] || exit 1
  [[ $(cat "$state/ready") == ready ]] || exit 1
  cmp -s "$work/identity" "$state/identity"
  cksum /etc/systemd/system/d570-deadline.service /etc/systemd/system/d570-deadline.timer /etc/systemd/system/d570-reboot.service "$state/clock" > "$work/units"
  cmp -s "$work/units" "$state/units"
fi
read -r observed monotonic extra < "$state/clock"
[[ "$observed" =~ ^[0-9]{10}$ && "$monotonic" =~ ^[0-9]{1,10}$ && -z "$extra" ]] || exit 1
now=$(/usr/bin/date +%s)
[[ "$now" =~ ^[0-9]{10}$ ]] || exit 1
(( now >= observed && now >= @START@ && now < @EXPIRY@ )) || exit 1
read -r uptime idle < /proc/uptime
[[ "$uptime" =~ ^[0-9]+\.[0-9]+$ ]] || exit 1
uptime=${uptime%%.*}
(( uptime < monotonic )) || exit 1
/usr/bin/timeout 10 /usr/bin/systemctl is-active --quiet d570-deadline.timer
[[ $(/usr/bin/timeout 10 /usr/bin/systemctl is-enabled d570-reboot.service) == enabled ]] || exit 1
now=$(/usr/bin/date +%s)
[[ "$now" =~ ^[0-9]{10}$ ]] || exit 1
(( now >= observed && now >= @START@ && now < @EXPIRY@ )) || exit 1
read -r uptime idle < /proc/uptime
[[ "$uptime" =~ ^[0-9]+\.[0-9]+$ ]] || exit 1
uptime=${uptime%%.*}
(( uptime < monotonic )) || exit 1
# Incomplete installation stays closed. An exact retry reads without rearming.
if [[ ! -f "$state/ready" ]]; then
  printf '%s\n' ready > "$work/ready"
  install -m 600 "$work/ready" "$state/ready"
fi
printf '%s\n' 'D570_DEADLINE_READY @RUN@ @EXPIRY@ '"$boot"
