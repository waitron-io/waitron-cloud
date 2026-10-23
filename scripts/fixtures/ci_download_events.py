"""Retain fixture progress even when supervision stops a child."""

import json
import os
import time


def record(directory, stage, **details):
    event = {"time": time.monotonic(), "pid": os.getpid(), "stage": stage, **details}
    with (directory / "progress.jsonl").open("a") as output:
        output.write(json.dumps(event) + "\n")
