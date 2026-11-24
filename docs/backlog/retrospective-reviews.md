# Retrospective Cloud reviews (D535)

The reviews stopped on 7 November 2026 at #417. The product repairs landed; these limits of the
reviewed test fixtures remain.

- **Registry refusals.** A message holding both HTTP 403 and `unexpected EOF` follows the
  network-retry path. Reproduce a real recurrence before adding a retry classification.
- **Optional cache saves** share the enclosing job's deadline; a slow save can exhaust it.
- **Missing-signal controls** in the browser fixtures wrap a configured wait in a longer race.
  They catch an overrun but do not pin the exact value, and several ordinary observations pass
  when removed. Preserve the checks; reproduce a real ordering failure before changing them.
- **Duplicate-request controls** for passkey Enter and authenticator setup cover the English,
  light, 390-pixel case only.
- **Failure path:** removing the session-list controller's pending-load guard leaves the test
  process alive after its timeout. Make that regression fail and clean up within its bounds.
- **Sign-out failure observation (D361):** a missing signal can report a response timeout
  instead. Contain the competing rejection before claiming precise diagnostics.
- **Captures:** give each fixture its own fresh receipt directory; names overlap across files,
  and assertions do not check names. Byte equality is a per-run observation.
- **Local command failures** keep exit signals Node knows; the historical Linux worker-admission
  failure and the Docker-backed integration are unqualified.
- These checks use stubbed HTTP in Chromium. Other engines, production networks, real authority
  and the historical Linux causes are unqualified.
