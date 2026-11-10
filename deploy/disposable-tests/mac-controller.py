#!/usr/bin/env python3
"""Start the trusted Node controller without caller-supplied runtime injection."""
import os
from pathlib import Path
import sys


def main(argv):
    if len(argv) < 3:
        raise ValueError('Usage: mac-controller.py ABSOLUTE_NODE CONFIG --once | --bootstrap | LANE CHECKOUT -- COMMAND [ARGS]')
    node, configuration, *args = argv
    if not Path(node).is_absolute() or not Path(configuration).is_absolute():
        raise ValueError('Node and immutable configuration need absolute paths')
    if len(args)>=6 and args[0]=='remote' and args[5]=='--':
        args[4]=os.path.abspath(args[4])
    elif len(args) >= 3 and args[2] == '--':
        args[1] = os.path.abspath(args[1])
    environment = {key: value for key, value in os.environ.items()
                   if key not in ('NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONHOME')}
    entry = 'manual.mjs'
    if args and args[0] == 'canary':
        entry = 'ci-canary.mjs'
        args = args[1:]
    elif args and args[0] == 'control':
        entry = 'control.mjs'
        args = args[1:]
    script = Path(__file__).resolve().parents[2] / 'scripts/disposable-tests' / entry
    os.chdir('/')
    os.execve(node, [node, str(script), configuration, *args], environment)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(125)
