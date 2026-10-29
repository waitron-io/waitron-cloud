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

## A response body can outlive pnpm's request timeout

The observer's first failed merge run, `40677826792`, identifies an unfinished
`@napi-rs/canvas-linux-x64-gnu@1.0.10` download in job `122780751423`.
At the existing 300-second setup limit, it reports 983,040 of 14,214,570 bytes,
attempt one, with all other 669 packages available and imported. No install script
is running. This identifies the unfinished transfer; it does not identify the
registry, network or client cause. Earlier unlabelled failures remain separate.

Keep the outer setup limit even when the installer has its own request timeout.
Native Node 26.11.1 and pnpm 9.15.0 controls use a generated archive and a local HTTP
server. With the request timeout set to one second for this probe, waiting for
headers fails in about one second. Sending headers and then stopping the body, or
sending small chunks every 400 milliseconds, leaves the installer running until
the probe stops it after 3.5 seconds. A complete response installs successfully;
damaged bytes fail the locked checksum. These are controlled native observations,
not a reproduction of the historical Linux network condition.

Run `node --test scripts/cloud-cost/conformance-install-transport.test.mjs` to
exercise the actual setup supervisor and pnpm against the local server. Five
controls cover missing headers, stalled and progressing bodies, a complete archive
and damaged bytes. Source acquisition supplies a generated package and frozen
lockfile; installation uses the real CLI, an isolated store and no install scripts.
The generated source has no runtime bundle, so the complete-archive control checks
the successful installation record before fixture construction refuses. It does
not qualify a running venue. Only the disposable supervisor's clock is accelerated;
the production limit stays five minutes. The checks require the unfinished-package
snapshot, checksum refusal, collected installer and removed scratch directory.

Lane D must obtain evidence from the affected Linux transfer before proposing a
repair. A fast native download, a passing changed CI run and this controlled stall
do not establish that cause. Keep the source revision, lockfile, integrity checks,
request settings, outer limit and process-group cleanup unchanged. Genuine local
container qualification remains blocked while Docker is down.

## Bounded pinned-source acquisition (D482)

The D458 connection refusal and D480 five-minute fetch stall occurred before any
conformance case. Their underlying network causes remain unknown. Source fetches
now set Git's low-speed limit to 1,000 bytes per second for 60 seconds and retain
a supervised 75-second maximum per attempt. You get the attempt number, elapsed
time, outcome and Git's own error. A recognised transport failure or supervised
fetch timeout permits one retry, after removing and reinitialising only the owned
partial checkout. Two failed attempts fail setup. Bad references, authentication
refusals and unrecognised errors stop immediately; interruption never retries.
Checkout and exact revision verification still precede the frozen installation.

Run `node --test scripts/cloud-cost/conformance-source-fetch.test.mjs` for native
child-process controls: a stalled first fetch then success, repeated stalls,
connection and low-speed refusals, permanent failures, a healthy fetch, wrong
revision and interruption. External Git responses are substituted and only the
disposable supervisor's timers are accelerated. These controls qualify the retry
boundary, not the historical GitHub transport cause. The pinned revision,
installation and conformance assertions stay unchanged. Genuine local Docker
qualification remains unavailable during the outage; GitHub CI runs that work.
