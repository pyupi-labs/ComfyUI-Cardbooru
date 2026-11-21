import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { styleButton } from "./button_style.js";

const normalize = (text) => text.normalize("NFKC").replaceAll("_", " ").trim().replace(/\s+/g, " ").toLowerCase();
// Use Python's Unicode casefold identity consistently, including ß/ss.
const group = (c) => JSON.stringify(c.group_key);
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
            box.style.cssText = "color:var(--input-text,#eee);padding:10px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;height:100%;font:13px system-ui";
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
            image.style.cssText = "width:100%;min-height:0;flex:1 1 0;object-fit:contain;display:none";
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
                editor.prompt.value = value;
                if (editor.prompt.inputEl) editor.prompt.inputEl.value = value;
            }
            for (const editor of editors) {
                const promptCallback = editor.prompt.callback;
                editor.prompt.callback = function () {
                    promptCallback?.apply(this, arguments);
                    editor.edited.value = true;
                    editor.editVersion++;
                    node.graph?.setDirtyCanvas(true, true);
                };
                const editedCallback = editor.edited.callback;
                editor.edited.callback = function () {
                    editedCallback?.apply(this, arguments);
                    editor.editVersion++;
                    if (!editor.edited.value && currentCard) setPrompt(editor, currentCard[editor.key] ?? "");
                };
            }
            function resetEditor(editor) {
                if (!currentCard) return;
                editor.editVersion++;
                setPrompt(editor, currentCard[editor.key] ?? "");
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
                node.properties.cardbooruSelectionCleared = true;
                for (const editor of editors) {
                    editor.editVersion++;
                    setPrompt(editor, "");
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
                        setPrompt(editor, c[editor.key] ?? "");
                    }
                }
                node.properties.cardbooruPromptSource = {root: root.value || "", card: c.path};
                currentCard = c;
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
                const close = element("button", "Close", dialog);
                close.onclick = () => dialog.close();
                const search = element("input", "", dialog);
                search.placeholder = "Search character, variant, or series";
                search.style.cssText = "width:65%;margin:12px";
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
            const configured = node.onConfigure;
            node.onConfigure = function () {
                configured?.apply(this, arguments);
                load();
            };
            const removed = node.onRemoved;
            node.onRemoved = function () { disposed = true; revision++; picker?.close(); removed?.apply(this, arguments); };
            clear();
            return result;
        };
    },
});
