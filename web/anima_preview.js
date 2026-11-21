import { app } from "../../scripts/app.js";
import { styleButton } from "./button_style.js";

app.registerExtension({
    name: "cardbooru.animaPreview",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!["CardbooruConcatenateAnima", "CardbooruConcatenateSpaces", "CardbooruConcatenateAnima3Advanced", "CardbooruLoadImagePrompts"].includes(nodeData.name)) return;
        const imageLoader = nodeData.name === "CardbooruLoadImagePrompts";
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            let latestText = null, dialog = null, output = null, note = null;
            const update = () => {
                if (!output) return;
                output.value = latestText ?? "";
                note.textContent = latestText === null
                    ? "No executed output yet. Run the workflow to capture the final text."
                    : "Exact output from the last execution of this node (before text encoding). Run again after changing prompts, images, or options.";
            };
            const openPreview = () => {
                if (dialog) { dialog.focus(); return; }
                dialog = document.createElement("dialog");
                dialog.style.cssText = "width:min(900px,90vw);height:75vh;padding:18px;background:#292929;color:#eee;border:1px solid #8a8a8a;border-radius:12px;box-sizing:border-box";
                const title = document.createElement("h3");
                title.textContent = imageLoader ? "Final prompts · Last execution" : "Final prompt · Last execution";
                note = document.createElement("p");
                output = document.createElement("textarea");
                output.readOnly = true;
                output.setAttribute("aria-label", "Final prompt from last execution");
                output.style.cssText = "width:100%;height:65%;box-sizing:border-box;resize:none;font:14px monospace";
                const close = document.createElement("button");
                close.textContent = "Close";
                styleButton(close);
                close.onclick = () => dialog.close();
                dialog.append(title, note, output, close);
                dialog.onclose = () => { dialog.remove(); dialog = output = note = null; };
                document.body.append(dialog);
                update(); dialog.showModal();
            };
            if (imageLoader) {
                // The loader renders its own compact Preview button beside Refresh.
                this.cardbooruOpenPromptPreview = openPreview;
                this.cardbooruClearPromptPreview = () => { latestText = null; update(); };
            } else {
                const button = this.addWidget("button", "Preview", null, openPreview);
                button.options = {...button.options, serialize: false};
            }
            const executed = this.onExecuted;
            this.onExecuted = function (message) {
                executed?.apply(this, arguments);
                if (Array.isArray(message?.text) && typeof message.text[0] === "string") {
                    latestText = message.text[0];
                    update();
                }
                if (imageLoader && message?.image?.[0] === this.widgets.find(w => w.name === "image")?.value &&
                    typeof message?.positive?.[0] === "string" && typeof message?.negative?.[0] === "string") {
                    latestText = `Positive:\n${message.positive[0]}\n\nNegative:\n${message.negative[0]}`;
                    update();
                }
            };
            const configured = this.onConfigure;
            this.onConfigure = function () {
                latestText = null;
                update();
                configured?.apply(this, arguments);
            };
            const removed = this.onRemoved;
            this.onRemoved = function () { dialog?.close(); removed?.apply(this, arguments); };
            return result;
        };
    },
});
