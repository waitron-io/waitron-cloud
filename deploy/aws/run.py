"""Run only the generated fixed suite plan inside the offline container."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


def run():
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
            commands = [
                ["tofu", "init", "-backend=false", "-input=false", "-no-color"],
                ["tofu", "validate", "-no-color"],
                ["tofu", "test", f"-filter={entry['filter']}", "-no-color"],
            ]
            for command in commands:
                print(f"{entry['directory']}: {' '.join(command)}", flush=True)
                subprocess.run(command, cwd=work / entry["directory"], env=environment, check=True, timeout=90)


if __name__ == "__main__":
    run()
