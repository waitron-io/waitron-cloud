"""Run only the generated fixed suite plan inside the offline container."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

import hcl2


def test_groups(source):
    tree = hcl2.parses_to_tree(source)
    runs = [block.meta for block in tree.children[0].children
            if getattr(block, "data", None) == "block"
            and str(block.children[0].children[0]) == "run"]
    if len(runs) <= 6:
        return [(source, len(runs))]
    groups = []
    for offset in range(0, len(runs), 6):
        selected = set(range(offset, min(offset + 6, len(runs))))
        parts, position = [], 0
        for index, block in enumerate(runs):
            parts.append(source[position:block.start_pos])
            text = source[block.start_pos:block.end_pos]
            parts.append(text if index in selected else "".join("\n" if char == "\n" else " " for char in text))
            position = block.end_pos
        parts.append(source[position:])
        groups.append(("".join(parts), len(selected)))
    return groups


def run():
    # A CPU quota leaves the host CPU mask visible. Restrict inherited affinity
    # so Go runtimes size their worker pools within the two-CPU process budget.
    os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:2])
    with tempfile.TemporaryDirectory(prefix="cloud-aws-") as scratch:
        work = Path(scratch) / "source"
        shutil.copytree("/candidate/source", work)
        environment = {
            "PATH": "/opt/software/bin:/usr/local/bin:/usr/bin:/bin",
            "HOME": scratch,
            "TF_CLI_CONFIG_FILE": "/opt/test-cli.tfrc",
            "TF_IN_AUTOMATION": "1",
            "CHECKPOINT_DISABLE": "1",
            "AWS_EC2_METADATA_DISABLED": "true",
            "AWS_SHARED_CREDENTIALS_FILE": "/dev/null",
            "AWS_CONFIG_FILE": "/dev/null",
        }
        for entry in json.loads(Path("/candidate/suite.json").read_text()):
            root = work / entry["directory"]
            for command in [
                ["tofu", "init", "-backend=false", "-input=false", "-no-color"],
                ["tofu", "validate", "-no-color"],
            ]:
                print(f"{entry['directory']}: {' '.join(command)}", flush=True)
                subprocess.run(command, cwd=root, env=environment, check=True, timeout=90)
            path = root / entry["filter"]
            source = path.read_text()
            groups = test_groups(source)
            command = ["tofu", "test", f"-filter={entry['filter']}", "-no-color"]
            try:
                for group, count in groups:
                    path.write_text(group)
                    print(f"{entry['directory']}: {' '.join(command)}", flush=True)
                    if len(groups) == 1:
                        subprocess.run(command, cwd=root, env=environment, check=True, timeout=90)
                        continue
                    # Expected-refusal plans can retain provider children until
                    # OpenTofu exits. Bound each process without raising limits.
                    result = subprocess.run(command, cwd=root, env=environment, check=False, timeout=90, capture_output=True, text=True)
                    print(result.stdout, end="", flush=True)
                    print(result.stderr, end="", file=sys.stderr, flush=True)
                    result.check_returncode()
                    summary = re.search(r"Success! ([0-9]+) passed, 0 failed\.", result.stdout)
                    if summary is None or int(summary[1]) != count:
                        raise ValueError("An isolated group did not execute every planned case")
            finally:
                path.write_text(source)
            if len(groups) > 1:
                print(f"Isolated suite aggregate: Success! {sum(count for _, count in groups)} passed, 0 failed.", flush=True)


if __name__ == "__main__":
    run()
