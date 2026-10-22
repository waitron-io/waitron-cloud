"""Use a signed Ubuntu mirror for CI browser dependencies."""

import argparse
from pathlib import Path
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apt-root', type=Path, default=Path('/etc/apt'))
    args = parser.parse_args()
    files = [args.apt_root / 'sources.list']
    parts = args.apt_root / 'sources.list.d'
    files.extend(sorted(parts.glob('*.list')))
    files.extend(sorted(parts.glob('*.sources')))
    for path in files:
        if not path.is_file():
            continue
        with path.open(newline='') as source:
            original = source.read()
        # Change the mirror URI only; suites, components and signing keys stay intact.
        updated = re.sub(r'(?<!\S)https?://(?:azure\.)?archive\.ubuntu\.com/ubuntu(?=/?(?:\s|$))',
                         'https://mirror.math.princeton.edu/pub/ubuntu', original)
        updated = re.sub(r'(?<!\S)mirror\+file:/etc/apt/apt-mirrors\.txt(?=\s|$)',
                         'https://mirror.math.princeton.edu/pub/ubuntu', updated)
        if updated != original:
            with path.open('w', newline='') as source:
                source.write(updated)
            print(f'Using https://mirror.math.princeton.edu/pub/ubuntu in {path}', flush=True)


if __name__ == '__main__':
    main()
