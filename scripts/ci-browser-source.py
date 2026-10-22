"""Use Ubuntu's primary signed archive for CI browser dependencies."""

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
        original = path.read_text()
        # Change the mirror URI only; suites, components and signing keys stay intact.
        updated = re.sub(r'(?<!\S)https?://azure\.archive\.ubuntu\.com/ubuntu(?=/?(?:\s|$))',
                         'https://archive.ubuntu.com/ubuntu', original)
        if updated != original:
            path.write_text(updated)
            print(f'Using https://archive.ubuntu.com/ubuntu in {path}', flush=True)


if __name__ == '__main__':
    main()
