"""Retain bounded progress when the isolated APT fixture fails."""

import json
import subprocess
import sys


def output_tail(value):
    if isinstance(value, bytes):
        return value[-4096:].decode('utf-8', errors='replace')
    return (value or '')[-4096:]


def run_apt(command, *, stage, scenario, mode, requests, request_start, **kwargs):
    def report(reason, stdout, stderr, **details):
        # Preserve the original result while keeping failure evidence below the parent's buffer.
        print(json.dumps({
            'event': 'apt-fixture-failure', 'stage': stage, 'scenario': scenario, 'mode': mode,
            'reason': reason, **details,
            'stdoutTail': output_tail(stdout), 'stderrTail': output_tail(stderr),
            'requestCount': len(requests) - request_start,
            'requestTail': [path[:200] for path in requests[max(request_start, len(requests) - 16):]],
        }), file=sys.stderr, flush=True)

    try:
        result = subprocess.run(command, **kwargs)
    except subprocess.TimeoutExpired as error:
        report('TimeoutExpired', error.stdout, error.stderr, timeout=error.timeout)
        raise
    if result.returncode != 0:
        report('exit', result.stdout, result.stderr, returncode=result.returncode)
    return result
