"""Offer ordered signed Ubuntu mirrors for CI browser dependencies."""

import argparse
from pathlib import Path
import re
import sys


ARCHIVE_URI = re.compile(r'https?://(?:azure\.)?archive\.ubuntu\.com/ubuntu/?|'
                         r'mirror\+file:/etc/apt/apt-mirrors\.txt')


def rewrite_source(path, original, mirror_uri, parser):
    if path.suffix != '.sources':
        def line(match):
            prefix, options, spacing, uri, tail = match.groups()
            if not ARCHIVE_URI.fullmatch(uri):
                return match.group()
            if options is None:
                options, spacing = 'by-hash=no', ' '
            elif re.search(r'(?<!\S)by-hash=', options):
                options = re.sub(r'(?<!\S)by-hash=\S+', 'by-hash=no', options)
            else:
                options += ' by-hash=no'
            return f'{prefix}[{options}]{spacing}{mirror_uri}{tail}'
        return re.sub(r'^([ \t]*deb(?:-src)?[ \t]+)(?:\[([^\]\r\n]*)\]([ \t]+))?'
                      r'(\S+)([^\r\n]*)', line, original, flags=re.MULTILINE)
    chunks = re.split(r'(\r?\n[ \t]*\r?\n)', original)
    for i in range(0, len(chunks), 2):
        stanza = chunks[i]
        uris = re.search(r'^URIs:[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*', stanza, re.MULTILINE)
        if uris is None:
            continue
        values = uris.group().split(':', 1)[1].split()
        if not any(ARCHIVE_URI.fullmatch(uri) for uri in values):
            continue
        # One Deb822 policy covers every URI in its stanza; refuse to change a vendor's policy.
        if not all(ARCHIVE_URI.fullmatch(uri) for uri in values):
            parser.exit(1, f'Cannot prepare mixed Ubuntu and other URI stanza: {path}\n')
        changed = re.sub(r'(?<!\S)\S+', lambda m: mirror_uri if ARCHIVE_URI.fullmatch(m.group()) else m.group(), uris.group())
        stanza = stanza[:uris.start()] + changed + stanza[uris.end():]
        policy = re.compile(r'^By-Hash:[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*', re.MULTILINE | re.IGNORECASE)
        if policy.search(stanza):
            stanza = policy.sub('By-Hash: no', stanza)
        else:
            newline = '\r\n' if '\r\n' in stanza else '\n'
            ending = newline if stanza.endswith(newline) else ''
            stanza = stanza.removesuffix(ending) if ending else stanza
            stanza += newline + 'By-Hash: no' + ending
        chunks[i] = stanza
    return ''.join(chunks)


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
        # Source-local index policy keeps vendor hash addressing and signing keys intact.
        updated = rewrite_source(path, original, mirror_uri, parser)
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
