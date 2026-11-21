"""Sampler settings selected by the connected diffusion model's filename."""

from pathlib import PureWindowsPath


ANIMA_PRESETS = {
    'anima-base-v1.0.safetensors': {'Recommend': (30, 4.0), 'Maximum': (50, 5.0)},
    'anima-aesthetic-v1.1.safetensors': {'Recommend': (30, 4.0), 'Maximum': (50, 5.0)},
    'anima-turbo-v1.1.safetensors': {
        'Recommend': (8, 1.0), 'Maximum': (12, 1.0), 'Personal': (20, 2.0),
    },
}


class CardbooruControlPanel:
    CATEGORY = 'Cardbooru/Tools'
    DESCRIPTION = 'Choose steps, CFG, and denoise for the connected Anima model.'
    FUNCTION = 'settings'
    RETURN_TYPES = ('INT', 'FLOAT', 'FLOAT')
    RETURN_NAMES = ('steps', 'cfg', 'denoise')

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'model': ('MODEL',),
            'preset': (['Recommend', 'Maximum', 'Personal'], {'cardbooru_presets': ANIMA_PRESETS}),
            'denoise': ('FLOAT', {'default': 1.0, 'min': 0.0, 'max': 1.0, 'step': 0.01}),
        }, 'optional': {
            'steps': ('INT', {'default': 30, 'min': 1, 'max': 10000}),
            'cfg': ('FLOAT', {'default': 4.0, 'min': 0.0, 'max': 100.0, 'step': 0.1}),
        }}

    def settings(self, model, preset, denoise, steps=None, cfg=None):
        if not 0.0 <= denoise <= 1.0:
            raise ValueError('Denoise must be between 0.0 and 1.0.')

        # The core loader stores its source path in the patcher's reload arguments.
        reload_info = getattr(model, 'cached_patcher_init', None)
        args = reload_info[1] if reload_info else ()
        filename = PureWindowsPath(args[0]).name if args and isinstance(args[0], str) else ''
        presets = ANIMA_PRESETS.get(filename.casefold())
        if presets:
            if preset not in presets:
                steps, cfg = presets['Recommend']
            else:
                default_steps, default_cfg = presets[preset]
                steps = default_steps if steps is None else steps
                cfg = default_cfg if cfg is None else cfg
        if type(steps) is not int or not 1 <= steps <= 10000:
            raise ValueError('Steps must be an integer between 1 and 10000.')
        if cfg is None or not 0.0 <= cfg <= 100.0:
            raise ValueError('CFG must be between 0.0 and 100.0.')
        return steps, float(cfg), float(denoise)
