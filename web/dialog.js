export function forwardWidgetWheel(element, app) {
    element.addEventListener("wheel", (event) => {
        const canvas = app.canvas;
        if (event.defaultPrevented || !canvas?.processMouseWheel) return;
        event.stopPropagation();
        canvas.processMouseWheel(event);
    }, {passive: false});
}

export function closeOnBackdropClick(dialog) {
    function isBackdrop(event) {
        if (event.target !== dialog) return false;
        const {left, right, top, bottom} = dialog.getBoundingClientRect();
        return event.clientX < left || event.clientX >= right ||
            event.clientY < top || event.clientY >= bottom;
    }

    let startedOnBackdrop = false;
    dialog.addEventListener("pointerdown", (event) => {
        startedOnBackdrop = isBackdrop(event);
    });
    dialog.addEventListener("click", (event) => {
        if (startedOnBackdrop && isBackdrop(event)) dialog.close();
        startedOnBackdrop = false;
    });
}
