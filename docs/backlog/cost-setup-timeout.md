# Cost conformance setup timeout (D131)

PR #318 cost run `39959775169`, remote-browser job `120435513011`, stopped
before any test after a setup command reached its 300-second limit. Its log
contains no command or phase, so the historical cause remains unknown.
Setup now reports each supervised command's phase, arguments, process ID, elapsed
milliseconds and outcome to standard error. The command limit, checks, public
source revision and process-group cleanup stay unchanged; the environment is
excluded from diagnostics. Controlled timeout and nonzero-exit tests exercise the
real supervisor, retain the original five-minute deadline and verify scratch and
child cleanup. Existing SIGINT and SIGTERM cleanup checks remain intact.

Linux CI passed all seven remote-browser cases. Its trace records source fetch
in 1.8 seconds, installation in 23.6 seconds and browser-image acquisition in
32.8 seconds; no setup command timed out. Expected image-cache misses produce
a failed inspect record followed by a successful pull. Archive downloads now report their phase, public URL, HTTP status, elapsed time
and received bytes, with progress every ten seconds while waiting for headers or
body data. Completion means the file passed its pinned checksum and was written;
extraction retains its separate command trace. The 120-second download limit and
checksum, cancellation and extraction checks stay unchanged. Controlled local HTTP
checks cover success, refusal, damaged bytes, timeout, cancellation and interrupted
bodies. These diagnostics exclude the process environment. Lane D must
investigate a diagnostic recurrence at the named command before claiming a cause
or changing a deadline. This passing run does not explain or repair the historical
timeout. Local Docker-backed qualification remains unavailable while Docker is down.


