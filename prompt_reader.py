"""Reconstruct supported saved prompt graphs without running arbitrary nodes."""
import json
import re
import struct
import zlib

from PIL import Image

from .text_nodes import (CardbooruConcatenateSpaces, CardbooruConcatenateAnima,
                         CardbooruConcatenateAnima3, CardbooruConcatenateAnima3Advanced)


class PromptReadError(ValueError):
    pass


class GraphReader:
    MAX_TEXT = 4 * 1024 * 1024
    MAX_CACHED_TEXT = 16 * 1024 * 1024

    def __init__(self, graph):
        self.graph = graph
        self.warnings = []
        self.memo = {}
        self.pairs = {}
        self.cached_text = 0

    def value(self, value, seen=frozenset()):
        if isinstance(value, (str, bool, int, float)):
            return value
        if isinstance(value, list) and len(value) == 2:
            return self.node(str(value[0]), value[1], seen)
        raise PromptReadError('Unsupported or missing linked value')

    def text(self, value, seen=frozenset()):
        result = self.value(value, seen)
        if not isinstance(result, str):
            raise PromptReadError('Expected a text value')
        return result

    def node(self, node_id, slot=0, seen=frozenset()):
        if node_id in seen or len(seen) >= 128:
            raise PromptReadError(f'Cycle or excessive graph depth at node {node_id}')
        if type(slot) is not int or slot < 0:
            raise PromptReadError('Invalid output slot in saved graph')
        key = (node_id, slot)
        if key in self.memo:
            return self.memo[key]
        result = self._node(node_id, slot, seen)
        if isinstance(result, str):
            if len(result) > self.MAX_TEXT or self.cached_text + len(result) > self.MAX_CACHED_TEXT:
                raise PromptReadError('Reconstructed prompt exceeds the text budget')
            self.cached_text += len(result)
        self.memo[key] = result
        return result

    def _node(self, node_id, slot, seen):
        node = self.graph.get(node_id)
        if not isinstance(node, dict) or not isinstance(node.get('inputs'), dict):
            raise PromptReadError(f'Missing node or inputs: {node_id}')
        seen = seen | {node_id}
        kind, inputs = node.get('class_type'), node['inputs']
        if slot != 0 and kind not in ('CardbooruPrompts', 'CardbooruLoadImagePrompts', 'LoadImageX', 'OnlyLoadImagesWithMetadata'):
            raise PromptReadError(f'Unsupported output slot {slot} on {kind}')
        text = lambda key, default='': self.text(inputs.get(key, default), seen)
        value = lambda key, default=False: self.value(inputs.get(key, default), seen)
        if kind in ('PrimitiveString', 'PrimitiveStringMultiline'):
            return text('value')
        if kind == 'String Literal':
            return text('string')
        if kind in ('CardbooruConcatenate3', 'CardbooruConcatenate4'):
            keys = ('string_a', 'string_b', 'string_c') + (('string_d',) if kind == 'CardbooruConcatenate4' else ())
            return text('delimiter').join(text(key) for key in keys)
        if kind in ('CardbooruConcatenateAnima3', 'CardbooruConcatenateAnima3Advanced'):
            args = (text('string_a'), text('string_b'), text('string_c'), text('delimiter'))
            if kind == 'CardbooruConcatenateAnima3':
                return CardbooruConcatenateAnima3().concatenate(*args)[0]
            return CardbooruConcatenateAnima3Advanced().concatenate(*args,
                        preserve_score_tags=value('preserve_score_tags', True),
                        clean_commas=value('clean_commas', True))[0]
        if kind in ('StringConcatenate', 'CardbooruConcatenateSpaces', 'CardbooruConcatenateAnima'):
            a, b, delimiter = text('string_a'), text('string_b'), text('delimiter')
            if kind == 'StringConcatenate':
                return a + delimiter + b
            if kind == 'CardbooruConcatenateAnima':
                return CardbooruConcatenateAnima().concatenate(a, b, delimiter)[0]
            return CardbooruConcatenateSpaces().concatenate(a, b, delimiter,
                        value('preserve_score_tags', True), value('clean_commas', True))[0]
        if kind == 'Text Concatenate':
            return text('delimiter').join(text(k) for k in ('text_a', 'text_b', 'text_c', 'text_d') if k in inputs)
        if kind in ('CardbooruPositive', 'CardbooruPrompts'):
            polarity = 'negative' if slot == 1 and kind == 'CardbooruPrompts' else 'positive'
            if slot not in ((0, 1) if kind == 'CardbooruPrompts' else (0,)):
                raise PromptReadError(f'Invalid Cardbooru output: {slot}')
            key = polarity + '_prompt'
            flag = 'use_edited_negative' if polarity == 'negative' else 'use_edited_prompt'
            if key not in inputs:
                raise PromptReadError(f'Node {node_id} did not save its {polarity} text')
            if not value(flag):
                self.warnings.append(f'Cardbooru node {node_id}: using saved {polarity} widget text; the original card output was not stored separately.')
            return text(key)
        if kind == 'CardbooruLoadImagePrompts':
            polarity = 'positive' if slot == 2 else 'negative' if slot == 3 else None
            if not polarity:
                raise PromptReadError('Selected loader output is not text')
            if not value('use_edited_' + polarity):
                raise PromptReadError('A linked image metadata reader did not save its original output; use its edited text explicitly')
            result = text(polarity + '_prompt')
            if value('replace_underscores', True):
                result = CardbooruConcatenateSpaces().concatenate(result, '', '', value('preserve_score_tags', True), False)[0]
            if value('clean_commas', True):
                from .text_nodes import clean_prompt_commas
                result = clean_prompt_commas(result)
            return result
        if kind in ('LoadImageX', 'OnlyLoadImagesWithMetadata'):
            if slot not in (2, 3):
                raise PromptReadError('Selected image-loader output is not text')
            return text('positive_prompt' if slot == 2 else 'negative_prompt')
        if kind in ('CLIPTextEncode', 'CLIPTextEncodeFlux', 'PCLazyTextEncode', 'PCLazyTextEncodeAdvanced'):
            fields = [text(k) for k in ('text', 'clip_l', 't5xxl') if k in inputs]
            if not fields:
                raise PromptReadError(f'No text in encoder {node_id}')
            if len(set(fields)) > 1:
                raise PromptReadError(f'Encoder {node_id} has different text streams; a single string cannot represent them')
            return fields[0]
        if kind == 'ConditioningZeroOut':
            return ''
        if kind in ('ConditioningCombine', 'ConditioningConcat', 'ConditioningAverage'):
            keys = ('conditioning_1', 'conditioning_2') if kind == 'ConditioningCombine' else ('conditioning_to', 'conditioning_from')
            self.warnings.append(f'{kind} at {node_id}: texts are listed on separate lines; conditioning operations cannot be represented exactly as one string.')
            return '\n'.join(text(k) for k in keys)
        if kind in ('BasicGuider', 'ConditioningSetTimestepRange', 'ConditioningSetArea', 'ConditioningSetMask', 'ChromaPaddingRemoval', 'ConditioningMultiply'):
            return text('conditioning')
        if kind == 'ImpactWildcardProcessor':
            if 'populated_text' not in inputs:
                raise PromptReadError('Wildcard output is not stored; unresolved wildcards cannot be reconstructed')
            return text('populated_text')
        raise PromptReadError(f'Unsupported node {node_id}: {kind}. No partial prompt was returned.')

    def pair(self, node_id, seen=frozenset()):
        if node_id in seen or len(seen) >= 128:
            raise PromptReadError('Cycle or excessive depth in guider connections')
        if node_id in self.pairs:
            return self.pairs[node_id]
        result = self._pair(node_id, seen)
        self.pairs[node_id] = result
        return result

    def _pair(self, node_id, seen):
        seen = seen | {node_id}
        inputs = self.graph[node_id]['inputs']
        result = {}
        for polarity, keys in [('positive', ('positive', 'conditioning_positive', 'pos')),
                               ('negative', ('negative', 'conditioning_negative', 'neg', 'nag_negative'))]:
            key = next((k for k in keys if k in inputs), None)
            if key:
                result[polarity] = self.text(inputs[key])
            elif 'guider' in inputs:
                link = inputs['guider']
                if not isinstance(link, list) or str(link[0]) not in self.graph:
                    raise PromptReadError('Invalid guider link')
                guider = self.graph[str(link[0])]
                if guider.get('class_type') == 'BasicGuider':
                    result[polarity] = self.text(link) if polarity == 'positive' else ''
                else:
                    result[polarity] = self.pair(str(link[0]), seen)[polarity]
            else:
                result[polarity] = ''
        return result


def extract_graph(graph, sampler_id=''):
    if not isinstance(graph, dict) or len(graph) > 10000:
        raise PromptReadError('Invalid or excessively large prompt graph')
    reader = GraphReader(graph)
    candidates = [str(key) for key, node in graph.items() if isinstance(node, dict)
                  and isinstance(node.get('inputs'), dict)
                  and any(k in node['inputs'] for k in ('positive', 'conditioning_positive', 'pos', 'guider'))]
    if sampler_id:
        if sampler_id not in candidates:
            raise PromptReadError(f'Sampler/source ID {sampler_id} is not available. Candidates: {", ".join(candidates)}')
        candidates = [sampler_id]
    if candidates:
        # Prefer actual samplers over their guiders and conditioning helper nodes.
        samplers = [key for key in candidates if 'sampler' in graph[key].get('class_type', '').lower()]
        candidates = samplers or candidates
        pair = reader.pair(candidates[0])
        if len(candidates) > 1:
            reader.warnings.append(f'Multiple sampling sources: {", ".join(candidates)}. Using {candidates[0]}; set sampler_id to choose another stage.')
        return dict(pair, source=f'Prompt graph / node {candidates[0]}', warnings=list(dict.fromkeys(reader.warnings)))
    result = {'positive': '', 'negative': ''}
    for polarity, titles in [('positive', ('positive prompt', 'pos prompt', 'prompt')),
                             ('negative', ('negative prompt', 'neg prompt', 'negative'))]:
        matches = [str(key) for key, node in graph.items() if isinstance(node, dict)
                   and str(node.get('_meta', {}).get('title', '')).lower() in titles]
        if len(matches) > 1:
            raise PromptReadError(f'Ambiguous {polarity} titles without sampler connections')
        if matches:
            result[polarity] = reader.node(matches[0])
    if not result['positive']:
        encoders = [str(key) for key, node in graph.items() if isinstance(node, dict)
                    and node.get('class_type') in ('CLIPTextEncode', 'CLIPTextEncodeFlux')
                    and 'neg' not in str(node.get('_meta', {}).get('title', '')).lower()]
        if len(encoders) == 1:
            result['positive'] = reader.node(encoders[0])
        elif encoders:
            raise PromptReadError('Multiple unlabelled text encoders without sampler connections')
    return dict(result, source='Prompt graph / labels', warnings=list(dict.fromkeys(reader.warnings)))


def read_png_text(path):
    """Read text chunks including those after IDAT; never inflate pixel data."""
    limit = 4 * 1024 * 1024
    result = {}
    def inflate(data):
        decoder = zlib.decompressobj()
        try:
            value = decoder.decompress(data, limit + 1)
        except zlib.error as exc:
            raise PromptReadError('Invalid compressed PNG text') from exc
        if len(value) > limit or not decoder.eof:
            raise PromptReadError('Compressed text exceeds the metadata limit or is truncated')
        return value
    with open(path, 'rb') as stream:
        if stream.read(8) != b'\x89PNG\r\n\x1a\n':
            raise PromptReadError('Not a PNG image')
        while True:
            header = stream.read(8)
            if len(header) != 8:
                raise PromptReadError('Truncated PNG')
            size, kind = struct.unpack('>I4s', header)
            if kind in (b'tEXt', b'iTXt', b'zTXt'):
                if size > limit:
                    raise PromptReadError('Text metadata chunk is too large')
                data, crc = stream.read(size), stream.read(4)
                if len(data) != size or len(crc) != 4 or zlib.crc32(kind + data) & 0xffffffff != struct.unpack('>I', crc)[0]:
                    raise PromptReadError('Truncated or invalid PNG text chunk')
                key, sep, payload = data.partition(b'\0')
                if not sep or key not in (b'prompt', b'parameters'):
                    continue
                if kind == b'zTXt':
                    if payload[:1] != b'\0':
                        raise PromptReadError('Unsupported text compression')
                    payload = inflate(payload[1:])
                if kind == b'iTXt':
                    if payload[:2] not in (b'\0\0', b'\1\0'):
                        raise PromptReadError('Invalid iTXt compression')
                    compressed = payload[0]
                    fields = payload[2:].split(b'\0', 2)
                    if len(fields) != 3:
                        raise PromptReadError('Invalid iTXt fields')
                    payload = inflate(fields[2]) if compressed else fields[2]
                if kind == b'iTXt':
                    value = payload.decode('utf-8')
                else:
                    # PNG tEXt/zTXt are Latin-1; also accept UTF-8 used by some exporters.
                    try:
                        value = payload.decode('utf-8')
                    except UnicodeDecodeError:
                        value = payload.decode('latin-1')
                result[key.decode()] = value
            else:
                stream.seek(size + 4, 1)
            if kind == b'IEND':
                return result


def read_prompts(path, sampler_id=''):
    with open(path, 'rb') as stream:
        png = stream.read(8) == b'\x89PNG\r\n\x1a\n'
    if png:
        meta = read_png_text(path)
    else:
        with Image.open(path) as image:
            meta = dict(image.info)
    if meta.get('prompt'):
        # Do not fall back to a partial title or another format on traversal failure.
        graph = json.loads(meta['prompt'])
        return extract_graph(graph, sampler_id)
    if sampler_id:
        raise PromptReadError('sampler_id requires a saved prompt graph')
    if isinstance(meta.get('parameters'), str):
        body = re.split(r'\r?\nSteps:\s*\d+', meta['parameters'], maxsplit=1, flags=re.I)[0]
        pieces = re.split(r'\r?\nNegative prompt:\s*', body, maxsplit=1, flags=re.I)
        return dict(positive=pieces[0].strip(), negative=pieces[1].strip() if len(pieces) > 1 else '', source='A1111 parameters', warnings=[])
    return dict(positive='', negative='', source='No supported prompt metadata', warnings=['No saved prompt graph or A1111 parameters were found.'])
