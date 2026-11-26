import { app } from "../../scripts/app.js";
import { styleButton } from "./button_style.js";
import { closeOnBackdropClick } from "./dialog.js";

const presetGroups = [
    ["Speed", "#8bc8ff", [[768, 1024], [576, 1024]]],
    ["Good", "#91d6a3", [[1024, 1024], [832, 1248], [768, 1280], [720, 1280]]],
    ["Okay", "#e6ca82", [[864, 1152], [896, 1120], [768, 1344], [896, 1344], [1152, 1152]]],
    ["Heavy", "#f4a385", [[864, 1536], [1024, 1536], [1280, 1280], [1152, 1536]]],
];

function ratio(width, height) {
    if (width === 768 && height === 1344) return "≈9:16";
    let a = width;
    let b = height;
    while (b) [a, b] = [b, a % b];
    return `${width / a}:${height / a}`;
}

function openPresets(applyDimensions) {
    const dialog = document.createElement("dialog");
    closeOnBackdropClick(dialog);
    dialog.setAttribute("aria-label", "Image size presets");
    dialog.style.cssText = "width:min(480px,90vw);max-height:85vh;overflow:auto;padding:16px;background:#292929;color:#eee;border:1px solid #666;border-radius:10px";
    const heading = document.createElement("h3");
    heading.textContent = "Image size presets";
    heading.style.marginTop = "0";
    const note = document.createElement("p");
    note.textContent = "Select a first-pass size. The 1.25× size is shown for reference.";
    dialog.append(heading, note);

    for (const [name, color, presets] of presetGroups) {
        const group = document.createElement("h4");
        group.textContent = name;
        group.style.cssText = `color:${color};margin:12px 0 4px`;
        dialog.append(group);
        for (const [width, height] of presets) {
            const button = document.createElement("button");
            styleButton(button);
            button.style.cssText += ";display:block;width:100%;margin:2px 0;text-align:left;font:13px monospace;white-space:normal";
            const mp = (width * height / 1_000_000).toFixed(2);
            button.textContent = `${ratio(width, height)} · ${width}×${height} → ${width * 1.25}×${height * 1.25} · ${mp} MP`;
            button.onclick = () => {
                applyDimensions(width, height);
                dialog.close();
            };
            dialog.append(button);
        }
    }

    const close = document.createElement("button");
    styleButton(close);
    close.textContent = "Close";
    close.style.marginTop = "12px";
    close.onclick = () => dialog.close();
    dialog.append(close);
    dialog.onclose = () => dialog.remove();
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}

app.registerExtension({
    name: "Cardbooru.ImageSize",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "CardbooruImageSize") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            const width = this.widgets.find(widget => widget.name === "width");
            const height = this.widgets.find(widget => widget.name === "height");
            let dialog;
            const applyDimensions = (newWidth, newHeight) => {
                width.value = newWidth;
                height.value = newHeight;
                width.callback?.(newWidth);
                height.callback?.(newHeight);
                this.setDirtyCanvas(true, true);
            };
            const presets = this.addWidget("button", "Presets", null, () => {
                if (!dialog?.open) dialog = openPresets(applyDimensions);
            });
            const swap = this.addWidget("button", "Swap", null, () => {
                applyDimensions(height.value, width.value);
            });
            presets.options = {...presets.options, serialize: false};
            swap.options = {...swap.options, serialize: false};
            const removed = this.onRemoved;
            this.onRemoved = function () {
                if (dialog?.open) dialog.close();
                return removed?.apply(this, arguments);
            };
            return result;
        };
    },
});
