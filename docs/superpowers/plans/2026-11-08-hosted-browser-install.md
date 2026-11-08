# D615: hosted browser install

Authority: Lane G watcher2026-11-08 16:45 assigns D615 to remove repeated Chromium system-package installation. Readings only; runtime unverified. Lane I `questions.md`, “ANSWER TO LANE G D615 routing”: “Cloud portal and ui-smoke jobs remain on ubuntu-latest in the current A1440 scope. A1440’s automatic controller policy and routing PR target Waitron; the six-job Cloud canary is an explicitly dispatched proof, not automatic Cloud package routing. No current A1440 change moves Cloud browser packages onto guests.”

Allowed config: `.github/workflows/ci.yml:362`, delete only `--with-deps`. Tests: remove that argument from exact-command checks in `scripts/ci-workflow.test.mjs:90` and `scripts/ci-download.test.mjs:38`; add nothing. Fixture extracts workflow shell; argv: `['--filter','@waitron-cloud/ui-smoke','exec','playwright','install','chromium']`. Preserve bounds, timeouts, retries, caching, selection and behavioral assertions. Exclude guest/host changes, installers/fallbacks and unrelated pins.

Prose: this plan; `docs/backlog.md`, only D613’s measurement sentence, including hosted browser preparation.

Driver commits plan, Claude reads, watcher approves before build; D614 takes priority when its CI completes. Red after checks change, green after workflow edit: `node --test scripts/ci-workflow.test.mjs scripts/ci-download.test.mjs`. Finish: current-head hosted portal+ui-smoke suites and install logs; no Mac browser qualification. PR budget: 30 minutes excluding watcher approval wait.

Estimate: product code0; workflow+1/−1line; tests+2/−2lines; backlog+2/−1line and this short plan. No new test cases.
