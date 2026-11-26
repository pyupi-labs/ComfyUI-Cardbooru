// Shared appearance, scoped to this package's DOM buttons.
export function styleButton(button, tile = false) {
    button.type = 'button';
    button.className = `${button.className || ''} cardbooru-button`.trim();
    button.style.cssText += ';box-sizing:border-box;appearance:none;background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);border:1px solid var(--border-color,#666);border-radius:3px;font:inherit;cursor:pointer;';
    if (!tile) button.style.cssText += 'min-height:28px;padding:3px 10px;white-space:nowrap;';
    if (document.head && !document.getElementById('cardbooru-button-styles')) {
        const style = document.createElement('style');
        style.id = 'cardbooru-button-styles';
        style.textContent = '.cardbooru-button:hover:not(:disabled){filter:brightness(1.2)}.cardbooru-button:disabled{opacity:.4;cursor:default}.cardbooru-button:focus-visible{outline:2px solid var(--input-text,#ddd);outline-offset:2px}';
        document.head.append(style);
    }
    return button;
}
