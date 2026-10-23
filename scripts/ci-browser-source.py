"""Use a signed Ubuntu mirror for CI browser dependencies."""

import argparse
from pathlib import Path
import re
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apt-root', type=Path, default=Path('/etc/apt'))
    args = parser.parse_args()
    files = [args.apt_root / 'sources.list']
    parts = args.apt_root / 'sources.list.d'
    files.extend(sorted(parts.glob('*.list')))
    files.extend(sorted(parts.glob('*.sources')))
    sources = []
    for path in files:
        if not path.is_file():
            continue
        try:
            with path.open(encoding='utf-8', newline='') as source:
                sources.append((path, source.read()))
        except (OSError, UnicodeError):
            parser.exit(1, f'Cannot read APT source as UTF-8: {path}\n')
    changed = False
    # Read every input before writing so an unreadable vendor file leaves sources intact.
    for path, original in sources:
        # Change the mirror URI only; suites, components and signing keys stay intact.
        updated = re.sub(r'(?<!\S)https?://(?:azure\.)?archive\.ubuntu\.com/ubuntu(?=/?(?:\s|$))',
                         'https://mirror.math.princeton.edu/pub/ubuntu', original)
        updated = re.sub(r'(?<!\S)mirror\+file:/etc/apt/apt-mirrors\.txt(?=\s|$)',
                         'https://mirror.math.princeton.edu/pub/ubuntu', updated)
        if updated != original:
            with path.open('w', encoding='utf-8', newline='') as source:
                source.write(updated)
            print(f'Using https://mirror.math.princeton.edu/pub/ubuntu in {path}', flush=True)
            changed = True
    if not changed:
        print('Warning: no Ubuntu archive URI was rewritten; sources may already be '
              'prepared or the runner layout may have changed.', file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()
