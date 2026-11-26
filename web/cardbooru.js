import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { styleButton } from "./button_style.js";
import { closeOnBackdropClick } from "./dialog.js";

const normalize = (text) => text.normalize("NFKC").replaceAll("_", " ").trim().replace(/\s+/g, " ").toLowerCase();
// Use Python's Unicode casefold identity consistently, including ß/ss.
const group = (c) => JSON.stringify(c.group_key);
const promptFields = text => {
    const fields = [];
    const stack = [];
    let start = 0, escaped = false;
    const pairs = {")": "(", "]": "[", "}": "{"};
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (escaped) { escaped = false; continue; }
        if (char === "\\") { escaped = true; continue; }
        if ("([{".includes(char)) stack.push(char);
        else if (pairs[char] && stack.at(-1) === pairs[char]) stack.pop();
        if (char === "," && !stack.length) { fields.push(text.slice(start, i)); start = i + 1; }
    }
    fields.push(text.slice(start));
    return fields;
};
const element = (tag, text, parent) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (parent) parent.append(el);
    if (tag === "button") styleButton(el);
    return el;
};

app.registerExtension({
    name: "cardbooru.positive",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!["CardbooruPositive", "CardbooruPrompts"].includes(nodeData.name)) return;
        const combined = nodeData.name === "CardbooruPrompts";
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            const node = this;
            const root = node.widgets.find((w) => w.name === "library_root");
            const selected = node.widgets.find((w) => w.name === "card");
            const edited = node.widgets.find((w) => w.name === "use_edited_prompt");
            // Keep the serialized input name for existing workflows and API prompts.
            edited.label = "use_edited_positive";
            const prompt = node.widgets.find((w) => w.name === "positive_prompt");
            const copyright = node.widgets.find((w) => w.name === "use_copyright");
            // Change visual order while preserving serialized widget positions.
            const layoutWidgets = node.getLayoutWidgets;
            node.getLayoutWidgets = function () {
                const widgets = [...layoutWidgets.apply(this, arguments)];
                const index = widgets.indexOf(copyright);
                if (index !== -1 && widgets.includes(selected)) {
                    widgets.splice(index, 1);
                    widgets.splice(widgets.indexOf(selected) + 1, 0, copyright);
                }
                return widgets;
            };
            const editors = [{key: "positive", prompt, edited}];
            if (combined) editors.push({
                key: "negative",
                prompt: node.widgets.find((w) => w.name === "negative_prompt"),
                edited: node.widgets.find((w) => w.name === "use_edited_negative"),
            });
            node.properties ||= {};
            for (const editor of editors) editor.editVersion = 0;
            let cards = [], revision = 0, picker = null, disposed = false;
            let currentCard = null;
            const box = element("div");
            box.style.cssText = "color:var(--input-text,#eee);padding:10px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:100%;min-width:0;max-width:none;height:100%;font:13px system-ui";
            const controls = element("div", "", box);
            controls.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0";
            const open = element("button", "Library", controls);
            const refresh = element("button", "Refresh", controls);
            refresh.title = "Reread card metadata from disk and replace local prompt edits";
            const reset = element("button", "↺ Positive", controls);
            reset.title = "Restore the embedded card prompt";
            const resetNegative = combined ? element("button", "↺ Negative", controls) : null;
            if (combined) { reset.textContent = "↺ Positive"; resetNegative.title = "Restore the embedded negative, or empty text if absent"; }
            const previous = element("button", "◀", controls);
            previous.title = "Previous variant";
            const next = element("button", "▶", controls);
            next.title = "Next variant";
            const base = element("button", "Base", controls);
            base.title = "Go to the Base variant of this character and series";
            const remove = element("button", "Delete", controls);
            remove.title = "Clear this node's selection and prompts; keep the PNG in the library";
            const label = element("div", "Select a card", box);
            label.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0";
            const image = element("img", "", box);
            image.alt = "Card preview";
            image.style.cssText = "width:100%;min-width:0;min-height:0;flex:1 1 0;object-fit:contain;object-position:center;display:none";
            const libraryHint = () => root.value?.trim() ? "Drop a PNG from the configured library here." : "Set library_root to browse cards.";
            const status = element("div", libraryHint(), box);
            status.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:16px;height:32px;overflow:auto;flex-shrink:0";
            const preview = node.addDOMWidget("cardbooru_preview", "cardbooru", box, { serialize: false });
            preview.computeLayoutSize = () => {
                const width = node.size[0];
                const imageSpace = currentCard ? Math.round(Math.min(440, Math.max(180, width * 0.62))) : 0;
                const buttonSpace = controls.offsetHeight || 62;
                const minHeight = buttonSpace + 84 + imageSpace;
                return {minWidth: 0, minHeight, maxHeight: currentCard ? Infinity : minHeight};
            };
            // Keep standard serialized multiline editors below the shared preview.
            for (const editor of editors) {
                // Let ComfyUI distribute extra height across the preview and editors.
                editor.prompt.computeLayoutSize = () => ({minWidth: 0, minHeight: 78, maxHeight: Infinity});
                node.widgets.splice(node.widgets.indexOf(editor.prompt), 1);
                node.widgets.push(editor.prompt);
            }
            node.size = [420, combined ? 460 : 340];
            function setPrompt(editor, value) {
                editor.updating = true;
                try {
                    editor.prompt.value = value;
                    if (editor.prompt.inputEl) editor.prompt.inputEl.value = value;
                } finally {
                    editor.updating = false;
                }
            }
            function setEmbeddedPrompt(editor, value) {
                if (editor.key === "positive") delete node.properties.cardbooruCopyrightPrefix;
                setPrompt(editor, value);
            }
            function updateCopyright() {
                const prefix = node.properties.cardbooruCopyrightPrefix;
                let value = prompt.value ?? "";
                let fields = promptFields(value);
                const previousIndex = prefix ? fields.findIndex(field => field.trim() === prefix) : -1;
                if (previousIndex !== -1) fields.splice(previousIndex, 1);
                delete node.properties.cardbooruCopyrightPrefix;

                const tag = currentCard?.series?.trim().toLowerCase();
                if (copyright.value && tag && !fields.some(field => field.trim().toLowerCase() === tag)) {
                    const isCount = field => /^\d+(girls?|boys?|others?)$/i.test(field.trim());
                    const character = promptFields(currentCard.positive).find(field => field.trim() && !isCount(field))?.trim().toLowerCase();
                    let index = fields.findIndex(field => character && field.trim().toLowerCase() === character);
                    if (index === -1) index = fields.findIndex(field => field.trim() && !isCount(field));
                    if (index === -1) index = fields.length - 1;
                    node.properties.cardbooruCopyrightPrefix = tag;
                    fields.splice(index + 1, 0, tag);
                }
                if (previousIndex !== -1 || node.properties.cardbooruCopyrightPrefix) {
                    value = fields.map(field => field.trim()).filter(Boolean).join(", ");
                }
                setPrompt(editors[0], value);
                node.graph?.setDirtyCanvas(true, true);
            }
            const copyrightCallback = copyright.callback;
            copyright.callback = function () {
                copyrightCallback?.apply(this, arguments);
                if (currentCard) updateCopyright();
            };
            for (const editor of editors) {
                const promptCallback = editor.prompt.callback;
                editor.prompt.callback = function () {
                    promptCallback?.apply(this, arguments);
                    if (editor.updating) return;
                    editor.edited.value = true;
                    editor.editVersion++;
                    node.graph?.setDirtyCanvas(true, true);
                };
                const editedCallback = editor.edited.callback;
                editor.edited.callback = function () {
                    editedCallback?.apply(this, arguments);
                    editor.editVersion++;
                    if (!currentCard) return;
                    const drafts = node.properties.cardbooruPromptDrafts ??= {};
                    if (!editor.edited.value) {
                        drafts[editor.key] = {text: editor.prompt.value,
                            prefix: editor.key === "positive" ? node.properties.cardbooruCopyrightPrefix : undefined};
                        setEmbeddedPrompt(editor, currentCard[editor.key] ?? "");
                        if (editor.key === "positive") updateCopyright();
                    } else if (drafts[editor.key]) {
                        const draft = drafts[editor.key];
                        setPrompt(editor, draft.text);
                        if (editor.key === "positive") {
                            node.properties.cardbooruCopyrightPrefix = draft.prefix;
                            updateCopyright();
                        }
                    }
                    node.graph?.setDirtyCanvas(true, true);
                };
            }
            function resetEditor(editor) {
                if (!currentCard) return;
                editor.editVersion++;
                delete node.properties.cardbooruPromptDrafts?.[editor.key];
                setEmbeddedPrompt(editor, currentCard[editor.key] ?? "");
                if (editor.key === "positive") updateCopyright();
                node.graph?.setDirtyCanvas(true, true);
            }
            reset.onclick = () => resetEditor(editors[0]);
            if (resetNegative) resetNegative.onclick = () => resetEditor(editors[1]);
            const query = (extra = {}) => new URLSearchParams({root: root.value || "", ...extra});
            const thumb = (c) => api.apiURL(`/cardbooru/thumbnail?${query({card: c.path})}`);
            async function request(path, options) {
                const response = await api.fetchApi(path, options);
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
                return data;
            }
            function clear() {
                cards = [];
                currentCard = null;
                image.removeAttribute("src"); image.style.display = "none";
                label.textContent = "Select a card";
                previous.disabled = next.disabled = true;
                base.disabled = true;
            }
            remove.onclick = () => {
                revision++;
                picker?.close();
                selected.value = "";
                delete node.properties.cardbooruPromptSource;
                delete node.properties.cardbooruPromptDrafts;
                node.properties.cardbooruSelectionCleared = true;
                for (const editor of editors) {
                    editor.editVersion++;
                    setEmbeddedPrompt(editor, "");
                }
                clear();
                status.textContent = "Selection cleared. Choose another card from Library or drop a PNG.";
                node.graph?.setDirtyCanvas(true, true);
            };
            function choose(c, reloadPrompts = false, versions = null) {
                const source = node.properties.cardbooruPromptSource;
                const sameSource = source?.root === (root.value || "") && source?.card === c.path;
                for (const editor of editors) {
                    if (versions && versions[editor.key] !== editor.editVersion) continue;
                    if (reloadPrompts || !sameSource || !editor.edited.value) {
                        if (reloadPrompts || !sameSource) delete node.properties.cardbooruPromptDrafts?.[editor.key];
                        setEmbeddedPrompt(editor, c[editor.key] ?? "");
                    }
                }
                node.properties.cardbooruPromptSource = {root: root.value || "", card: c.path};
                currentCard = c;
                updateCopyright();
                selected.value = c.path;
                node.properties.cardbooruSelectionCleared = false;
                label.textContent = `${c.character} / ${c.variant || "No variant"} / ${c.series}`;
                label.title = label.textContent;
                image.src = thumb(c); image.style.display = "block";
                const minimum = node.computeSize?.();
                if (minimum && minimum[1] > node.size[1]) node.setSize([node.size[0], minimum[1]]);
                const count = cards.filter((other) => group(other) === group(c)).length;
                previous.disabled = next.disabled = count < 2;
                base.disabled = !cards.some((other) => group(other) === group(c) && other.is_base && other.path !== c.path);
                node.graph?.setDirtyCanvas(true, true);
            }
            async function load({reloadPrompts = false} = {}) {
                const ticket = ++revision;
                const versions = Object.fromEntries(editors.map(e => [e.key, e.editVersion]));
                clear();
                if (!root.value?.trim()) {
                    status.textContent = libraryHint();
                    return false;
                }
                status.textContent = "Loading library…";
                try {
                    const data = await request(`/cardbooru/library?${query(reloadPrompts ? {refresh: "1"} : {})}`, {cache: "no-store"});
                    if (disposed || ticket !== revision) return false;
                    cards = data.cards;
                    const current = cards.find((c) => c.path === selected.value || c.copies.includes(selected.value)) ||
                        (!node.properties.cardbooruSelectionCleared && cards.find((c) => c.path === data.initial_card));
                    if (current) choose(current, reloadPrompts, versions);
                    status.textContent = `${cards.length} cards · ${data.root}` +
                        (data.issues.length ? `\n${data.issues.join("\n")}` : "") +
                        (!current && selected.value ? "\nThe saved selection is no longer available." : "");
                    return true;
                } catch (error) {
                    if (!disposed && ticket === revision) status.textContent = error.message;
                    return false;
                }
            }
            function showPicker() {
                picker?.close();
                const dialog = picker = element("dialog");
                dialog.style.cssText = "width:min(900px,90vw);height:80vh;background:#201b25;color:#eee;border:1px solid #80658c;border-radius:12px;padding:18px";
                closeOnBackdropClick(dialog);
                const toolbar = element("div", "", dialog);
                toolbar.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px";
                const close = element("button", "Close", toolbar);
                styleButton(close);
                close.onclick = () => dialog.close();
                const search = element("input", "", toolbar);
                search.placeholder = "Search character, variant, or series";
                search.setAttribute("aria-label", search.placeholder);
                search.style.cssText = "box-sizing:border-box;flex:1;min-width:0;height:28px;padding:4px 9px;background:var(--comfy-input-bg,#262626);color:var(--input-text,#eee);border:1px solid var(--border-color,#666);border-radius:4px;font:inherit;font-size:13px";
                const grid = element("div", "", dialog);
                grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px";
                function render() {
                    grid.replaceChildren();
                    const term = normalize(search.value);
                    const found = cards.filter((c) => normalize(`${c.character} ${c.variant} ${c.series}`).includes(term));
                    for (const c of found) {
                        const button = element("button", "", grid);
                        button.style.cssText = "padding:8px;background:#302838;color:#eee;border:1px solid #80658c;cursor:pointer";
                        styleButton(button, true);
                        const img = element("img", "", button);
                        img.loading = "lazy"; img.src = thumb(c); img.alt = c.character;
                        img.style.cssText = "width:100%;height:170px;object-fit:contain";
                        element("div", `${c.character} · ${c.variant || "No variant"}`, button);
                        element("small", c.series, button);
                        button.onclick = () => { choose(c); dialog.close(); };
                    }
                    if (!found.length) element("p", "No matching cards found.", grid);
                }
                search.oninput = render;
                dialog.onclose = () => { dialog.remove(); if (picker === dialog) picker = null; };
                document.body.append(dialog); render(); dialog.showModal(); search.focus();
            }
            open.onclick = async () => { if (await load()) showPicker(); };
            refresh.onclick = () => load({reloadPrompts: true});
            function cycle(delta) {
                const current = cards.find((c) => c.path === selected.value);
                if (!current) return;
                const variants = cards.filter((c) => group(c) === group(current));
                choose(variants[(variants.indexOf(current) + delta + variants.length) % variants.length]);
            }
            previous.onclick = () => cycle(-1); next.onclick = () => cycle(1);
            base.onclick = () => {
                if (!currentCard) return;
                const target = cards.find((c) => group(c) === group(currentCard) && c.is_base);
                if (target && target.path !== currentCard.path) choose(target);
            };
            const rootCallback = root.callback;
            root.callback = function () {
                rootCallback?.apply(this, arguments);
                node.properties.cardbooruSelectionCleared = false;
                picker?.close();
                load();
            };
            const cardCallback = selected.callback;
            selected.callback = function () { cardCallback?.apply(this, arguments); load(); };
            box.addEventListener("dragover", (event) => { event.preventDefault(); event.stopPropagation(); });
            box.addEventListener("drop", async (event) => {
                event.preventDefault(); event.stopPropagation();
                const file = event.dataTransfer.files[0];
                if (!file) return;
                const rootAtDrop = root.value;
                if (!await load() || disposed || root.value !== rootAtDrop) return;
                const ticket = revision;
                try {
                    const data = await request(`/cardbooru/match?${query({name: file.name})}`, {
                        method: "POST", headers: {"Content-Type": "application/octet-stream"}, body: file
                    });
                    if (!disposed && ticket === revision) choose(data.card);
                } catch (error) { if (!disposed && ticket === revision) status.textContent = error.message; }
            });
            const serialize = node.onSerialize;
            node.onSerialize = function (info) {
                serialize?.apply(this, arguments);
                info.cardbooruCopyrightWidget = true;
            };
            const configured = node.onConfigure;
            node.onConfigure = function (info) {
                configured?.apply(this, arguments);
                const values = info?.widgets_values;
                if (values && !info.cardbooruCopyrightWidget) {
                    // Older workflows saved values before the copyright toggle was added.
                    const index = node.widgets.indexOf(copyright);
                    copyright.value = false;
                    for (let i = index + 1; i < node.widgets.length; i++) {
                        const widget = node.widgets[i];
                        if (widget === preview || values[i - 1] === undefined) continue;
                        const editor = editors.find((entry) => entry.prompt === widget);
                        if (editor) setPrompt(editor, values[i - 1]);
                        else widget.value = values[i - 1];
                    }
                }
                load();
            };
            const removed = node.onRemoved;
            node.onRemoved = function () { disposed = true; revision++; picker?.close(); removed?.apply(this, arguments); };
            clear();
            return result;
        };
    },
});
