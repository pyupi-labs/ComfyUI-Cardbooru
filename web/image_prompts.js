import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { styleButton } from "./button_style.js";

app.registerExtension({
    name: "cardbooru.imagePrompts",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "CardbooruLoadImagePrompts") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            const node = this;
            node.properties ||= {};
            const widget = name => node.widgets.find(w => w.name === name);
            const editors = ["positive", "negative"].map(key => ({key,
                editVersion: 0,
                prompt: widget(`${key}_prompt`), edited: widget(`use_edited_${key}`)}));
            let revision = 0, disposed = false, latest = null;
            const box = document.createElement("div");
            box.style.cssText = "padding:8px;box-sizing:border-box;height:100%;overflow:auto;color:var(--input-text,#eee)";
            const refresh = document.createElement("button");
            refresh.textContent = "Refresh";
            refresh.title = "Reread metadata and replace local prompt edits";
            const controls = document.createElement("div");
            controls.style.cssText = "display:flex;gap:8px;width:100%";
            const previewButton = document.createElement("button");
            previewButton.textContent = "Preview";
            previewButton.title = "Show final prompts from the last execution";
            previewButton.onclick = () => node.cardbooruOpenPromptPreview?.();
            const clearButton = document.createElement("button");
            clearButton.textContent = "Delete";
            clearButton.title = "Clear the selected image without deleting the file";
            clearButton.onclick = () => {
                widget("image").value = "";
                load();
            };
            for (const button of [refresh, previewButton, clearButton]) {
                button.style.cssText = "flex:1;min-width:0";
                styleButton(button);
            }
            controls.append(refresh, previewButton, clearButton);
            const status = document.createElement("p");
            status.style.cssText = "white-space:pre-wrap;max-height:100px;overflow:auto;font:12px system-ui";
            // Keep ComfyUI's native preview and use the server folder picker for browsing.
            box.append(controls, status);
            const dom = node.addDOMWidget("image_prompt_status", "cardbooru", box, {serialize: false});
            dom.computeSize = width => [width, 140];
            for (const editor of editors) {
                node.widgets.splice(node.widgets.indexOf(editor.prompt), 1);
                node.widgets.push(editor.prompt);
            }
            node.size = [460, 760];
            function setText(editor, text) {
                editor.prompt.value = text;
                if (editor.prompt.inputEl) editor.prompt.inputEl.value = text;
            }
            function apply(data, reset = false, versions = null) {
                latest = data;
                for (const editor of editors) {
                    if (versions && versions[editor.key] !== editor.editVersion) continue;
                    if (reset || !editor.edited.value) {
                        editor.edited.value = false;
                        setText(editor, data[editor.key] ?? "");
                    }
                }
                status.textContent = [data.source, ...(data.warnings || [])].filter(Boolean).join("\n");
                node.graph?.setDirtyCanvas(true, true);
            }
            async function load(reset = false) {
                const ticket = ++revision;
                const image = widget("image").value;
                if (!image) {
                    latest = null;
                    delete node.properties.cardbooruLoadedImage;
                    node.imgs = null;
                    node.imageIndex = null;
                    for (const editor of editors) {
                        editor.edited.value = false;
                        setText(editor, "");
                    }
                    node.cardbooruClearPromptPreview?.();
                    status.textContent = "Select or upload an image.";
                    node.graph?.setDirtyCanvas(true, true);
                    return;
                }
                const changed = node.properties.cardbooruLoadedImage !== image;
                if (changed) {
                    latest = null;
                    for (const editor of editors) {editor.edited.value = false; setText(editor, "");}
                }
                const versions = Object.fromEntries(editors.map(e => [e.key, e.editVersion]));
                status.textContent = "Reading prompt metadata…";
                const query = new URLSearchParams({image,
                    sampler_id: widget("sampler_id").value || "",
                    ...Object.fromEntries(["replace_underscores", "preserve_score_tags", "clean_commas"].map(name => [name, String(widget(name).value)]))});
                try {
                    const response = await api.fetchApi(`/cardbooru/image-prompts?${query}`, {cache: "no-store"});
                    const data = await response.json();
                    if (disposed || ticket !== revision) return;
                    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
                    node.properties.cardbooruLoadedImage = image;
                    apply(data, reset || changed, versions);
                } catch (error) {if (!disposed && ticket === revision) status.textContent = error.message;}
            }
            refresh.onclick = () => load(true);
            for (const name of ["image", "sampler_id", "replace_underscores", "preserve_score_tags", "clean_commas"]) {
                const input = widget(name), callback = input.callback;
                input.callback = function () {callback?.apply(this, arguments); load();};
            }
            for (const editor of editors) {
                const callback = editor.prompt.callback;
                editor.prompt.callback = function () {
                    callback?.apply(this, arguments);
                    editor.edited.value = true;
                    editor.editVersion++;
                    node.graph?.setDirtyCanvas(true, true);
                };
                const toggle = editor.edited.callback;
                editor.edited.callback = function () {
                    toggle?.apply(this, arguments);
                    editor.editVersion++;
                    if (!editor.edited.value && latest) setText(editor, latest[editor.key] ?? "");
                };
            }
            const executed = node.onExecuted;
            node.onExecuted = function (message) {
                executed?.apply(this, arguments);
                // Editors are inputs, not execution snapshots. Preview owns output text.
                if (message?.image?.[0] === widget("image").value && message?.status?.[0]) status.textContent = message.status[0];
            };
            const configured = node.onConfigure;
            node.onConfigure = function () {configured?.apply(this, arguments); load();};
            const removed = node.onRemoved;
            node.onRemoved = function () {disposed = true; revision++; removed?.apply(this, arguments);};
            load();
            return result;
        };
    },
});
