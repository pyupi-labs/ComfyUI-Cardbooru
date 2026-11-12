"""Independent Cardbooru positive and dual-prompt custom nodes."""
import asyncio
import io
from collections import OrderedDict
from pathlib import Path
from threading import RLock

import folder_paths
from aiohttp import web
from PIL import Image, ImageOps
from server import PromptServer

from .core import catalog, contained, describe, identity, read_card, read_metadata, resolve_root
from .text_nodes import CardbooruConcatenateAnima, CardbooruConcatenateSpaces
from .text_nodes import CardbooruConcatenateAnima3, CardbooruConcatenateAnima3Advanced
from .text_nodes import CardbooruConcatenate3, CardbooruConcatenate4
from .image_prompt_node import CardbooruLoadImagePrompts, prepare_prompts

WEB_DIRECTORY = './web'


class CardbooruPositive:
    CATEGORY = 'Cardbooru'
    FUNCTION = 'positive'
    RETURN_TYPES = ('STRING',)
    RETURN_NAMES = ('positive',)

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'library_root': ('STRING', {'default': '', 'tooltip': 'Library folder or full card path on the server. Leave empty to use ComfyUI/input.'}),
            'card': ('STRING', {'default': '', 'tooltip': 'Relative path of the selected card.'}),
        }, 'optional': {
            'use_edited_prompt': ('BOOLEAN', {'default': False, 'tooltip': 'Use the editable text instead of the embedded card prompt. Editing enables this automatically.'}),
            'positive_prompt': ('STRING', {'default': '', 'multiline': True, 'tooltip': 'Edit the positive for this workflow. The card PNG is never modified.'}),
        }}

    def selected_card(self, library_root, card):
        root = resolve_root(library_root, folder_paths.get_input_directory())
        if not card:
            raise ValueError('Select a card using Library')
        selected = contained(root, card)
        result = catalog(root)
        chosen = next((c for c in result['cards'] if selected == contained(root, c['path'])
                       or card in c['copies']), None)
        if chosen is None:
            raise ValueError('Card is missing, invalid, or has conflicting duplicates. Refresh the library.')
        return read_card(selected)

    def positive(self, library_root, card, use_edited_prompt=False, positive_prompt=''):
        if not card:
            return ('',)
        selected = self.selected_card(library_root, card)
        # Validate the card even when using a workflow-local edit.
        if use_edited_prompt:
            if not isinstance(positive_prompt, str):
                raise ValueError('The edited positive prompt must be a string.')
            return (positive_prompt,)
        return (selected['positive'],)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Catalog conflicts or selected metadata may have changed outside ComfyUI.
        return float('nan')


class CardbooruPrompts(CardbooruPositive):
    FUNCTION = 'prompts'
    RETURN_TYPES = ('STRING', 'STRING')
    RETURN_NAMES = ('positive', 'negative')

    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        inputs['optional'].update({
            'use_edited_negative': ('BOOLEAN', {'default': False, 'tooltip': 'Use the edited negative instead of card metadata. Editing enables this automatically.'}),
            'negative_prompt': ('STRING', {'default': '', 'multiline': True, 'tooltip': 'Edit the negative for this workflow. Cards without a negative start empty. The PNG is never modified.'}),
        })
        return inputs

    def prompts(self, library_root, card, use_edited_prompt=False, positive_prompt='',
                use_edited_negative=False, negative_prompt=''):
        if not card:
            return ('', '')
        selected = self.selected_card(library_root, card)
        positive = positive_prompt if use_edited_prompt else selected['positive']
        negative = negative_prompt if use_edited_negative else selected['negative']
        if not isinstance(positive, str) or not isinstance(negative, str):
            raise ValueError('Positive and negative prompts must be strings.')
        return (positive, negative)


NODE_CLASS_MAPPINGS = {
    'CardbooruConcatenate3': CardbooruConcatenate3,
    'CardbooruConcatenate4': CardbooruConcatenate4,
    'CardbooruPositive': CardbooruPositive,
    'CardbooruPrompts': CardbooruPrompts,
    'CardbooruConcatenateSpaces': CardbooruConcatenateSpaces,
    'CardbooruConcatenateAnima': CardbooruConcatenateAnima,
    'CardbooruConcatenateAnima3': CardbooruConcatenateAnima3,
    'CardbooruConcatenateAnima3Advanced': CardbooruConcatenateAnima3Advanced,
    'CardbooruLoadImagePrompts': CardbooruLoadImagePrompts,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    'CardbooruConcatenate3': 'Concatenate · x3',
    'CardbooruConcatenate4': 'Concatenate · x4',
    'CardbooruPositive': 'Cardbooru · Positive',
    'CardbooruPrompts': 'Cardbooru · Positive + Negative',
    'CardbooruConcatenateSpaces': 'Concatenate · Anima Advanced',
    'CardbooruConcatenateAnima': 'Concatenate · Anima',
    'CardbooruConcatenateAnima3': 'Concatenate · Anima 3',
    'CardbooruConcatenateAnima3Advanced': 'Concatenate · Anima 3 Advanced',
    'CardbooruLoadImagePrompts': 'Cardbooru · Load Image + Prompts',
}


def root_for(request):
    return resolve_root(request.query.get('root', ''), folder_paths.get_input_directory())


@PromptServer.instance.routes.get('/cardbooru/image-prompts')
async def image_prompts(request):
    try:
        query = request.query
        result = await asyncio.to_thread(prepare_prompts, query.get('image', ''),
            sampler_id=query.get('sampler_id', ''),
            replace_underscores=query.get('replace_underscores', 'true') == 'true',
            preserve_score_tags=query.get('preserve_score_tags', 'true') == 'true',
            clean_commas=query.get('clean_commas', 'true') == 'true')
        return web.json_response(result, headers={'Cache-Control': 'no-store'})
    except (ValueError, OSError, TypeError, KeyError, AttributeError) as exc:
        return web.json_response({'error': str(exc)}, status=400, headers={'Cache-Control': 'no-store'})


@PromptServer.instance.routes.get('/cardbooru/library')
async def library(request):
    try:
        refresh = request.query.get('refresh') == '1'
        if refresh:
            with _thumbnail_lock:
                _thumbnails.clear()
        result = await asyncio.to_thread(catalog, root_for(request), refresh=refresh)
        supplied = Path(request.query.get('root', '').strip().strip('"')).expanduser()
        if supplied.is_file() and supplied.suffix.lower() == '.png':
            requested = supplied.resolve().relative_to(Path(result['root'])).as_posix()
            result['initial_card'] = next((c['path'] for c in result['cards']
                                           if requested in c['copies']), '')
        return web.json_response(result, headers={'Cache-Control': 'no-store'})
    except (ValueError, OSError) as exc:
        return web.json_response({'error': str(exc)}, status=400)


@PromptServer.instance.routes.post('/cardbooru/match')
async def match(request):
    try:
        # The drop is inspected in memory, never copied into the library.
        if request.content_length is not None and request.content_length > 32 * 1024 * 1024:
            raise ValueError('PNG file is too large (maximum 32 MB)')
        data = bytearray()
        async for part in request.content.iter_chunked(65536):
            data.extend(part)
            if len(data) > 32 * 1024 * 1024:
                raise ValueError('PNG file is too large (maximum 32 MB)')
        target = describe(read_metadata(io.BytesIO(data)), request.query.get('name', 'card.png'))
        result = await asyncio.to_thread(catalog, root_for(request))
        found = next((c for c in result['cards'] if identity(c) == identity(target)), None)
        if found is None:
            raise ValueError('Card not found or has conflicting duplicates. Set library_root to its original folder and refresh.')
        return web.json_response({'card': found})
    except (ValueError, OSError, TypeError, AttributeError) as exc:
        return web.json_response({'error': str(exc)}, status=400)


_thumbnails = OrderedDict()
_thumbnail_lock = RLock()


def thumbnail(path):
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size, stat.st_ctime_ns)
    with _thumbnail_lock:
        if key in _thumbnails:
            _thumbnails.move_to_end(key)
            return _thumbnails[key]
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((320, 448))
        output = io.BytesIO()
        image.convert('RGBA').save(output, format='PNG')
    with _thumbnail_lock:
        _thumbnails[key] = output.getvalue()
        while len(_thumbnails) > 128:
            _thumbnails.popitem(last=False)
    return output.getvalue()


@PromptServer.instance.routes.get('/cardbooru/thumbnail')
async def preview(request):
    try:
        path = contained(root_for(request), request.query.get('card', ''))
        # Only expose validated cards, not arbitrary images outside the catalog format.
        await asyncio.to_thread(read_card, path)
        data = await asyncio.to_thread(thumbnail, path)
        return web.Response(body=data, content_type='image/png', headers={'Cache-Control': 'no-store'})
    except (ValueError, OSError, TypeError, AttributeError) as exc:
        return web.json_response({'error': str(exc)}, status=400)
