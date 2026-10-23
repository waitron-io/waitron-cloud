"""Retain fixture progress even when supervision stops a child."""

import json
import os
import time


def record(directory, stage, **details):
    event = {"time": time.monotonic(), "pid": os.getpid(), "stage": stage, **details}
    with (directory / "progress.jsonl").open("a") as output:
        output.write(json.dumps(event) + "\n")


def failure_details(directory, error):
    captured = "".join(value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value or ""
                       for value in (getattr(error, "stdout", None), getattr(error, "stderr", None)))
    path = directory / "progress.jsonl"
    progress = path.read_text() if path.exists() else "(no child reached the first step)"
    return captured + "\nFixture process/step progress before cleanup:\n" + progress
