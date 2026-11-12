"""ComfyUI image loading with server-side prompt reconstruction."""
import hashlib
from pathlib import Path

import folder_paths

from .prompt_reader import read_prompts
from .text_nodes import CardbooruConcatenateSpaces, clean_prompt_commas

def image_path(image):
    if not image:
        raise ValueError('Select or upload an image.')
    path = Path(folder_paths.get_annotated_filepath(image)).resolve()
    roots = [Path(getattr(folder_paths, name)()).resolve() for name in
             ('get_input_directory', 'get_output_directory', 'get_temp_directory')
             if hasattr(folder_paths, name)]
    if not any(path.is_relative_to(root) for root in roots) or not path.is_file():
        raise ValueError('Select an image inside ComfyUI input, output, or temp folders')
    return path


def prepare_prompts(image, sampler_id='', replace_underscores=True, preserve_score_tags=True,
                    clean_commas=True, use_edited_positive=False, positive_prompt='',
                    use_edited_negative=False, negative_prompt=''):
    path = image_path(image)
    result = (dict(positive='', negative='', source='Manual prompt overrides', warnings=[])
              if use_edited_positive and use_edited_negative else read_prompts(path, sampler_id.strip()))
    for kind in ('input', 'output', 'temp'):
        getter = getattr(folder_paths, f'get_{kind}_directory', None)
        if getter and path.is_relative_to(Path(getter()).resolve()):
            relative = path.relative_to(Path(getter()).resolve())
            result['preview'] = {'filename': relative.name, 'subfolder': relative.parent.as_posix(), 'type': kind}
            break
    for key, edited, override in [('positive', use_edited_positive, positive_prompt),
                                  ('negative', use_edited_negative, negative_prompt)]:
        text = override if edited else result[key]
        if not isinstance(text, str):
            raise ValueError('Prompt overrides must be strings')
        if replace_underscores:
            text = CardbooruConcatenateSpaces().concatenate(text, '', '', preserve_score_tags, False)[0]
        result[key] = clean_prompt_commas(text) if clean_commas else text
    return result


class CardbooruLoadImagePrompts:
    CATEGORY = 'Cardbooru'
    FUNCTION = 'load_image'
    RETURN_TYPES = ('IMAGE', 'MASK', 'STRING', 'STRING')
    RETURN_NAMES = ('image', 'mask', 'positive', 'negative')
    DESCRIPTION = 'Load an image and reconstruct saved positive/negative prompts. Optional Anima cleanup and editable workflow-local overrides.'

    @classmethod
    def INPUT_TYPES(cls):
        root = Path(folder_paths.get_input_directory())
        files = sorted(p.relative_to(root).as_posix() for p in root.rglob('*')
                       if p.is_file() and p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'))
        return {'required': {
            'image': (['', *files], {'image_upload': True}),
            'replace_underscores': ('BOOLEAN', {'default': True}),
            'preserve_score_tags': ('BOOLEAN', {'default': True}),
            'clean_commas': ('BOOLEAN', {'default': True}),
            'sampler_id': ('STRING', {'default': '', 'advanced': True, 'tooltip': 'Leave empty for automatic selection. If multiple stages exist, enter a sampling source ID shown in the status.'}),
        }, 'optional': {
            'use_edited_positive': ('BOOLEAN', {'default': False}),
            'use_edited_negative': ('BOOLEAN', {'default': False}),
            'positive_prompt': ('STRING', {'default': '', 'multiline': True}),
            'negative_prompt': ('STRING', {'default': '', 'multiline': True}),
        }}

    def load_image(self, image, **options):
        prompts = prepare_prompts(image, **options)
        # Delegate tensor/mask conversion and frame handling to the installed ComfyUI.
        from nodes import LoadImage
        pixels, mask = LoadImage().load_image(image)
        return {'ui': {'positive': [prompts['positive']], 'negative': [prompts['negative']],
                       'image': [image],
                       'status': [prompts['source'] + '\n' + '\n'.join(prompts['warnings'])]},
                'result': (pixels, mask, prompts['positive'], prompts['negative'])}

    @classmethod
    def IS_CHANGED(cls, image, **kwargs):
        digest = hashlib.sha256()
        with image_path(image).open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        return digest.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image, **kwargs):
        try:
            image_path(image)
            return True
        except (ValueError, OSError) as exc:
            return str(exc)
