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


## Source installation stops at 669 of 670 packages

D400 job `122675571593` and D409 job `122754483156` reach the same
`source-install` phase, then stop at 669 downloaded and added packages until the
existing 300-second limit kills the command. No conformance case starts. The
missing package, transfer or install script and the underlying cause remain unknown.

You now get a bounded `install-progress` summary every ten seconds and when the
installer closes. It lists unfinished public package downloads with their observed
attempt and byte counts, packages awaiting import, active root and dependency
install scripts, failed scripts with their exit codes, and fixed pnpm error codes. The structured reporter supplies these events; raw messages,
script commands, URLs, host names, environment values and script output are excluded.
A summary retains at most 2,048 packages and displays 20 labels per category;
`truncated` and `discardedLines` expose incomplete diagnostics. Package totals count
distinct names and versions, so they need not equal pnpm's platform-specific totals.
The reporter changes logging only; the frozen lockfile, pinned source, checks,
command deadline and process-group cleanup remain intact.

Native macOS warm-cache and isolated fresh-cache installs of pinned Waitron
`fbadd15785464e59747e697c11048bfbc6e4938f` pass. The real native cadence setup also
completes without a container. Controlled child processes exercise download waits,
nonzero and zero exits, cancellation, periodic reports and cleanup. These checks
qualify the observer, not the historical Linux failure. Lane D must inspect the next
labelled Linux recurrence before proposing a repair. Genuine local container
qualification stays blocked while Docker is down.

The pinned source has a root `prepare` script and no install scripts in workspace
sub-packages. Extend the observer before relying on such scripts in a later source
revision; sub-package paths are not currently labelled. A real offline pnpm failure
qualifies the retained `ELIFECYCLE` code and failed-script exit status without
printing the command or its output. Other non-pnpm transport codes remain unqualified.
