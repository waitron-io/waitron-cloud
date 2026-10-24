"""Offer ordered signed Ubuntu mirrors for CI browser dependencies."""

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
    rewrites = []
    mirror_list = args.apt_root.absolute() / 'waitron-browser-mirrors.txt'
    mirror_uri = f'mirror+file:{mirror_list}'
    # Read every input before writing so an unreadable vendor file leaves sources intact.
    for path, original in sources:
        # Change the mirror URI only; suites, components and signing keys stay intact.
        updated = re.sub(r'(?<!\S)https?://(?:azure\.)?archive\.ubuntu\.com/ubuntu/?(?=\s|$)',
                         lambda _: mirror_uri, original)
        updated = re.sub(r'(?<!\S)mirror\+file:/etc/apt/apt-mirrors\.txt(?=\s|$)',
                         lambda _: mirror_uri, updated)
        if updated != original:
            rewrites.append((path, updated))
    if rewrites:
        # APT keeps release signatures and package hashes authoritative across mirrors.
        mirror_list.write_text('https://mirror.math.princeton.edu/pub/ubuntu\tpriority:1\n'
                               'https://archive.ubuntu.com/ubuntu\tpriority:2\n', encoding='utf-8')
        config = args.apt_root / 'apt.conf.d'
        config.mkdir(exist_ok=True)
        # Sort after runner retry defaults so dead connections leave time for fallback.
        (config / 'zzzz-waitron-browser-mirrors').write_text('Acquire::https::Timeout "10";\n', encoding='utf-8')
        for path, updated in rewrites:
            with path.open('w', encoding='utf-8', newline='') as source:
                source.write(updated)
            print(f'Using {mirror_uri} in {path}', flush=True)
    else:
        print('Warning: no Ubuntu archive URI was rewritten; sources may already be '
              'prepared or the runner layout may have changed.', file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()
