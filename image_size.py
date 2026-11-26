"""Editable image dimensions for generation workflows."""


class CardbooruImageSize:
    CATEGORY = 'Cardbooru/Tools'
    DESCRIPTION = 'Set image dimensions by hand or choose a resolution preset.'
    FUNCTION = 'dimensions'
    RETURN_TYPES = ('INT', 'INT')
    RETURN_NAMES = ('width', 'height')

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'width': ('INT', {'default': 768, 'min': 1, 'max': 16384}),
            'height': ('INT', {'default': 1024, 'min': 1, 'max': 16384}),
        }}

    def dimensions(self, width, height):
        return width, height
