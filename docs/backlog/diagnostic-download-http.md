# Diagnostic download HTTP boundaries

## Diagnostic download response validation (D410)

When you download a diagnostic, native HTTP/controller checks now prove that
nested extra fields, malformed service and incident metadata, duplicate entries,
and invalid timestamps cannot reach the file-saving callback. A well-formed
reply for another installation is also refused; a later valid retry still saves
the selected installation's document with its expected filename. These checks
exercise the existing response validator and preserve every permission and
cooldown rule. Server redaction and genuine browser downloads remain separate
CI and launch checks.

## Diagnostic download transport failures (D425)

A refused or unreadable diagnostic reply must never save a file. Native tests
exercise the real HTTP client and download controller for session and permission
refusals, service errors, broken JSON, empty replies and network failures. A
well-formed document inside an HTTP refusal is still refused. Each failed download
leaves a usable explicit retry; a server wait prevents another request until its
exact expiry, including both Retry-After formats. Run
`node --test apps/portal/test/diagnostic-transport-boundary.test.ts`.
These checks preserve the existing permissions and waits. Server redaction,
browser file downloads and production-network qualification remain separate gates.

## Diagnostic download replies after account changes (D400)

Native controller checks hold diagnostic replies while you change accounts,
return to the original account or sign out. Old documents, malformed replies,
refusals and rate limits cannot save a file, end a newer download or change its
selection, feedback or wait. Current downloads still finish, selecting the same
account keeps pending work, and an existing server wait remains in force.
