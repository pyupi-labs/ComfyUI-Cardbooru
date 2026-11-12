"""Standalone prompt string utilities; no image or library access."""
import re


def clean_prompt_commas(text):
    """Remove empty top-level comma fields without rewriting nested prompt syntax."""
    parts, current, stack = [], [], []
    escaped = False
    pairs = {')': '(', ']': '[', '}': '{'}
    for char in text:
        if escaped:
            current.append(char)
            escaped = False
            continue
        if char == '\\':
            current.append(char)
            escaped = True
            continue
        if char in '([{':
            stack.append(char)
        elif char in pairs and stack and stack[-1] == pairs[char]:
            stack.pop()
        if char == ',' and not stack:
            parts.append(''.join(current))
            current = []
        else:
            current.append(char)
    parts.append(''.join(current))
    return ', '.join(part.strip() for part in parts if part.strip())


class CardbooruConcatenateSpaces:
    CATEGORY = 'Cardbooru/Text'
    FUNCTION = 'execute'
    RETURN_TYPES = ('STRING',)
    RETURN_NAMES = ('text',)
    DESCRIPTION = 'Join prompt strings, replace underscores with spaces, and optionally clean empty comma fields. Preserves Anima score tags by default.'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'string_a': ('STRING', {'default': '', 'multiline': True}),
            'string_b': ('STRING', {'default': '', 'multiline': True}),
            'delimiter': ('STRING', {'default': '', 'tooltip': 'Inserted between the two strings. Comma cleanup is applied afterward when enabled.'}),
            'preserve_score_tags': ('BOOLEAN', {'default': True, 'tooltip': 'Keep score_1 through score_9 unchanged, as recommended for Anima. Turn off to replace every underscore.'}),
        }, 'optional': {
            'clean_commas': ('BOOLEAN', {'default': True, 'tooltip': 'Remove leading, trailing, and repeated top-level commas. Keep nested prompt syntax and repeated tags.'}),
        }}

    def concatenate(self, string_a='', string_b='', delimiter='', preserve_score_tags=True, clean_commas=True):
        text = string_a + delimiter + string_b
        if preserve_score_tags:
            text = re.sub(r'(?<!\w)score_[1-9](?!\w)|_',
                          lambda match: ' ' if match.group() == '_' else match.group(),
                          text, flags=re.IGNORECASE)
        else:
            text = text.replace('_', ' ')
        if clean_commas:
            text = clean_prompt_commas(text)
        return (text,)

    def execute(self, string_a='', string_b='', delimiter='', preserve_score_tags=True, clean_commas=True):
        result = self.concatenate(string_a, string_b, delimiter, preserve_score_tags, clean_commas)
        return {'ui': {'text': [result[0]]}, 'result': result}


class CardbooruConcatenateAnima(CardbooruConcatenateSpaces):
    FUNCTION = 'concatenate'
    DESCRIPTION = 'Join prompt strings, convert underscores to spaces, preserve score tags, and clean empty comma fields. All cleanup features are always enabled.'

    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        del inputs['required']['preserve_score_tags']
        del inputs['optional']
        return inputs

    def concatenate(self, string_a='', string_b='', delimiter=''):
        return super().concatenate(string_a, string_b, delimiter,
                                   preserve_score_tags=True, clean_commas=True)


class CardbooruConcatenateAnima3Advanced(CardbooruConcatenateSpaces):
    DEPRECATED = True
    DESCRIPTION = 'Join three prompt strings in A, B, C order with configurable Anima cleanup.'

    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        required = inputs['required']
        inputs['required'] = {key: value for key, value in list(required.items())[:2]}
        inputs['required']['string_c'] = ('STRING', {'default': '', 'multiline': True})
        inputs['required'].update(list(required.items())[2:])
        return inputs

    def concatenate(self, string_a='', string_b='', string_c='', delimiter='',
                    preserve_score_tags=True, clean_commas=True):
        joined = delimiter.join((string_a, string_b, string_c))
        return super().concatenate(joined, '', '', preserve_score_tags, clean_commas)

    def execute(self, string_a='', string_b='', string_c='', delimiter='',
                preserve_score_tags=True, clean_commas=True):
        result = self.concatenate(string_a, string_b, string_c, delimiter, preserve_score_tags, clean_commas)
        return {'ui': {'text': [result[0]]}, 'result': result}


class CardbooruConcatenateAnima3(CardbooruConcatenateAnima3Advanced):
    FUNCTION = 'concatenate'
    DESCRIPTION = 'Join three prompt strings in A, B, C order. Anima cleanup is always enabled.'

    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        del inputs['required']['preserve_score_tags']
        del inputs['optional']
        return inputs

    def concatenate(self, string_a='', string_b='', string_c='', delimiter=''):
        return super().concatenate(string_a, string_b, string_c, delimiter, True, True)


class CardbooruConcatenate3:
    CATEGORY = 'Cardbooru/Text'
    FUNCTION = 'concatenate'
    RETURN_TYPES = ('STRING',)
    RETURN_NAMES = ('text',)
    DESCRIPTION = 'Join three strings exactly in A, B, C order. No cleanup or tag changes.'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            **{f'string_{key}': ('STRING', {'default': '', 'multiline': True}) for key in 'abc'},
            'delimiter': ('STRING', {'default': ''}),
        }}

    def concatenate(self, string_a='', string_b='', string_c='', delimiter=''):
        return (delimiter.join((string_a, string_b, string_c)),)


class CardbooruConcatenate4(CardbooruConcatenate3):
    DESCRIPTION = 'Join four strings exactly in A, B, C, D order. No cleanup or tag changes.'

    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        delimiter = inputs['required'].pop('delimiter')
        inputs['required']['string_d'] = ('STRING', {'default': '', 'multiline': True})
        inputs['required']['delimiter'] = delimiter
        return inputs

    def concatenate(self, string_a='', string_b='', string_c='', string_d='', delimiter=''):
        return (delimiter.join((string_a, string_b, string_c, string_d)),)
