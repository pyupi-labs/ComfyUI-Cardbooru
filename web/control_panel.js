import { app } from "../../scripts/app.js";

function connectedFilename(node) {
    const modelSlot = node.inputs?.findIndex(input => input.name === "model") ?? -1;
    if (modelSlot < 0) return;

    let source = node.getInputNode(modelSlot);
    const visited = new Set();
    while (source?.type === "Reroute" && !visited.has(source)) {
        visited.add(source);
        source = source.getInputNode(0);
    }
    if (source?.comfyClass !== "UNETLoader" && source?.type !== "UNETLoader") return;
    const filename = source.widgets?.find(widget => widget.name === "unet_name")?.value;
    return typeof filename === "string" ? filename.split(/[\\/]/).pop().toLowerCase() : undefined;
}

app.registerExtension({
    name: "Cardbooru.ControlPanel",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "CardbooruControlPanel") return;
        const presets = nodeData.input?.required?.preset?.[1]?.cardbooru_presets ?? {};
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            const preset = this.widgets.find(widget => widget.name === "preset");
            const steps = this.widgets.find(widget => widget.name === "steps");
            const cfg = this.widgets.find(widget => widget.name === "cfg");
            let previousFilename;
            let previousPreset;
            let restoreValues = false;
            preset.options.values = ["Recommend"];

            const configured = this.onConfigure;
            this.onConfigure = function (info) {
                const response = configured?.apply(this, arguments);
                const savedPreset = info.widgets_values?.[0];
                if (savedPreset === "Turbo Personal") preset.value = "Personal";
                if (savedPreset === "Manual" || savedPreset === "Minimum") preset.value = "Recommend";
                restoreValues = Number.isFinite(info.widgets_values?.[2]) &&
                    Number.isFinite(info.widgets_values?.[3]);
                previousFilename = previousPreset = undefined;
                return response;
            };

            const refresh = () => {
                const filename = connectedFilename(this);
                const modelPresets = presets[filename];
                if (!filename) return;

                const modelChanged = filename !== previousFilename;
                const available = Object.keys(modelPresets ?? { Recommend: null });
                const invalidPreset = !available.includes(preset.value);
                if (modelChanged) preset.options.values = available;
                if (invalidPreset) {
                    preset.value = "Recommend";
                }
                if (modelChanged || preset.value !== previousPreset) {
                    const values = modelPresets?.[preset.value];
                    if (values && (!restoreValues || invalidPreset)) {
                        [steps.value, cfg.value] = values;
                    }
                    this.setDirtyCanvas(true, true);
                }
                restoreValues = false;
                previousFilename = filename;
                previousPreset = preset.value;
            };

            // Loader widget changes do not emit a connection event on this node.
            let timer;
            const start = () => {
                if (timer === undefined) timer = setInterval(refresh, 200);
            };
            const added = this.onAdded;
            this.onAdded = function () {
                const response = added?.apply(this, arguments);
                start();
                return response;
            };
            const removed = this.onRemoved;
            this.onRemoved = function () {
                clearInterval(timer);
                timer = undefined;
                return removed?.apply(this, arguments);
            };
            if (this.graph) start();
            return result;
        };
    },
});
