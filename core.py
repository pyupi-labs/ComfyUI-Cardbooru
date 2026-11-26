"""Cardbooru PNG catalog. No pixel decoding or ComfyUI dependency."""
from __future__ import annotations

import io
import json
import re
import struct
import unicodedata
import zlib
from functools import lru_cache
from pathlib import Path

LIMIT = 4 * 1024 * 1024


def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC', value).replace('_', ' ').split()).casefold()


def read_metadata(stream):
    if stream.read(8) != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Not a valid PNG file')
    result = {}
    while True:
        header = stream.read(8)
        if len(header) != 8:
            raise ValueError('Truncated PNG file')
        size, kind = struct.unpack('>I4s', header)
        if kind in (b'tEXt', b'iTXt', b'zTXt'):
            if size > LIMIT:
                raise ValueError('Metadata chunk is too large')
            data = stream.read(size)
            crc = stream.read(4)
            if len(data) != size or len(crc) != 4:
                raise ValueError('Truncated metadata')
            if zlib.crc32(kind + data) & 0xffffffff != struct.unpack('>I', crc)[0]:
                raise ValueError('Invalid metadata CRC')
            key, sep, value = data.partition(b'\0')
            if not sep or key not in (b'prompt', b'cardbooru'):
                continue
            if kind == b'zTXt':
                raise ValueError('Compressed metadata is not supported in this prototype')
            if kind == b'iTXt':
                if len(value) < 2 or value[:2] != b'\0\0':
                    raise ValueError('Compressed iTXt is not supported')
                fields = value[2:].split(b'\0', 2)
                if len(fields) != 3:
                    raise ValueError('Invalid iTXt chunk')
                value = fields[2]
            result[key.decode('ascii')] = value.decode('utf-8')
        else:
            # Seek over IDAT: never read or decompress the image pixels.
            stream.seek(size + 4, io.SEEK_CUR)
        if kind == b'IEND':
            return result


def describe(meta, filename):
    graph = json.loads(meta.get('prompt', '{}'))
    if not isinstance(graph, dict):
        raise ValueError('The prompt block must be a JSON object')
    candidates = [n for n in graph.values() if isinstance(n, dict)
                  and n.get('class_type') == 'CLIPTextEncode'
                  and isinstance(n.get('inputs', {}).get('text'), str)]
    negative_nodes = [n for n in graph.values() if isinstance(n, dict)
                      and normalize(n.get('_meta', {}).get('title', ''))
                      in ('negative prompt', 'neg prompt', 'negative')]
    if len(negative_nodes) > 1:
        raise ValueError('At most one negative prompt in Cardbooru format is supported')
    negative = ''
    if negative_nodes:
        node = negative_nodes[0]
        negative = node.get('inputs', {}).get('text')
        if node.get('class_type') != 'CLIPTextEncode' or not isinstance(negative, str):
            raise ValueError('The negative prompt must be a CLIPTextEncode text string')
    candidates = [n for n in candidates if n not in negative_nodes]
    titled = [n for n in candidates if normalize(n.get('_meta', {}).get('title', ''))
              in ('positive prompt', 'pos prompt', 'prompt')]
    candidates = titled or candidates
    if len(candidates) != 1 or not candidates[0]['inputs']['text'].strip():
        raise ValueError('Exactly one non-empty positive prompt in Cardbooru format is required')
    label = json.loads(meta.get('cardbooru', '{}'))
    if not isinstance(label, dict):
        raise ValueError('cardbooru must be a JSON object')
    match = re.fullmatch(r'(.+?)[_ ]*\((.+?)\)(?:[_ ]*\[(.+?)\])?', Path(filename).stem)
    fallback = [s.replace('_', ' ').strip() if s else '' for s in match.groups()] if match else ['', '', '']
    version = label.get('v', 0)
    if version == 2:
        character, variant, series = (label.get(k, '') for k in ('character', 'variant', 'series'))
    elif version in (0, 1):
        character = label.get('series') or fallback[0]
        variant = label.get('variant') or fallback[1]
        series = fallback[2]
    else:
        raise ValueError('Unsupported cardbooru version')
    if not all(isinstance(v, str) for v in (character, variant, series)):
        raise ValueError('Labels must be strings')
    if not normalize(character) or not normalize(series):
        raise ValueError('Missing character or series; save the card again from the web page')
    subvariant = label.get('subvariant')
    if isinstance(subvariant, str) and subvariant.strip():
        variant = f'{variant.strip()} ({subvariant.strip()})'
    return dict(character=character.strip(), variant=variant.strip(), series=series.strip(),
                main=label.get('main') is True, is_base=normalize(variant) == 'base',
                positive=candidates[0]['inputs']['text'], negative=negative)


def identity(card):
    return tuple(normalize(card[k]) for k in ('character', 'series', 'variant'))


def resolve_root(value):
    value = value.strip().strip('"').strip()
    if not value:
        raise ValueError('Set library_root to a card library folder.')
    path = Path(value).expanduser().resolve()
    if path.is_file() and path.suffix.lower() == '.png':
        path = path.parent
    if not path.is_dir():
        raise ValueError('The library folder does not exist on the ComfyUI server')
    return path


def contained(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path.suffix.lower() != '.png':
        raise ValueError('The card must be a PNG file inside the library')
    return path


@lru_cache(maxsize=4096)
def _cached(path, modified, size, changed):
    with open(path, 'rb') as stream:
        return describe(read_metadata(stream), Path(path).name)


def read_card(path):
    stat = path.stat()
    return dict(_cached(str(path), stat.st_mtime_ns, stat.st_size, stat.st_ctime_ns))


def catalog(root, refresh=False):
    if refresh:
        # Explicit refresh must reread disk even if an exporter preserved file stats.
        _cached.cache_clear()
    cards, issues, groups = [], [], {}
    for path in sorted(root.rglob('*'), key=lambda p: (str(p).casefold(), str(p))):
        if path.suffix.lower() != '.png' or not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        try:
            path = contained(root, relative)
            card = dict(read_card(path), path=relative)
            groups.setdefault(identity(card), []).append(card)
        except (ValueError, OSError, TypeError, KeyError, AttributeError) as exc:
            issues.append(f'{relative}: {exc}')
    for copies in groups.values():
        if len({(c['positive'], c['negative']) for c in copies}) > 1:
            issues.append('Prompt conflict; variant excluded: ' + ', '.join(c['path'] for c in copies))
            continue
        card = dict(copies[0], copies=[c['path'] for c in copies])
        card['group_key'] = list(identity(card)[:2])
        card['main'] = any(c['main'] for c in copies)
        cards.append(card)
        if len(copies) > 1:
            issues.append('Duplicate copies grouped: ' + ', '.join(card['copies']))
    cards.sort(key=lambda c: (normalize(c['series']), normalize(c['character']), not c['main'], normalize(c['variant']), c['path']))
    return dict(cards=cards, issues=issues, root=str(root))
