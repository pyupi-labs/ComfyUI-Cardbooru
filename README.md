# ComfyUI-Cardbooru

Custom nodes for browsing PNG character cards, formatting Anima prompts, and loading images with prompts reconstructed from supported metadata. Designed for ComfyUI portable on Windows. Cardbooru Desktop is optional.

## Installation

Download and extract the repository into `ComfyUI/custom_nodes/ComfyUI-Cardbooru`, or run the following command from `ComfyUI/custom_nodes`:

```powershell
git clone https://github.com/pyupi-labs/ComfyUI-Cardbooru.git
```

Restart ComfyUI and hard-refresh the browser with Ctrl+F5. If you already installed the older `cardbooru_nodes` folder, replace that copy to avoid duplicate node registrations.

| Node | Stable internal ID | Outputs |
| --- | --- | --- |
| Cardbooru · Positive | `CardbooruPositive` | positive STRING |
| Cardbooru · Positive + Negative | `CardbooruPrompts` | positive / negative STRING |
| Concatenate · Anima | `CardbooruConcatenateAnima` | text STRING |
| Concatenate · Anima Advanced | `CardbooruConcatenateSpaces` | text STRING |
| Concatenate · x3 | `CardbooruConcatenate3` | text STRING |
| Concatenate · x4 | `CardbooruConcatenate4` | text STRING |
| Cardbooru · Load Image + Prompts | `CardbooruLoadImagePrompts` | IMAGE / MASK / positive STRING / negative STRING |

Text outputs connect to text-encoder string inputs, not directly to CONDITIONING. MASK may remain disconnected.

## Card library nodes

- Set `library_root` to a folder on the ComfyUI server, or a full card PNG path to use its parent folder. Empty uses ComfyUI/input. Search is recursive. **Library** opens the searchable thumbnail picker.
- Embedded labels take precedence over filenames. Both `Uraraka Ochaco (Base) [Boku no Hero Academia].png` and legacy underscore names work. Filename fallback cannot recover a missing prompt. Folder names and English aliases do not define the series; keep embedded series names consistent.
- Identity uses character + series + variant, Unicode NFKC/casefold, collapsed whitespace, and equivalent underscores/spaces. Accents remain. Duplicate copies with identical positive/negative pairs appear once; conflicting pairs are excluded with a warning. No files are deleted.
- Arrows cycle within the selected character/series, main variants first, then alphabetical order. **Base** jumps to that group's valid Base variant; disabled when absent or already selected. It does not remove clothing tags or redefine main.
- Prompt fields are editable. Typing enables their override flags. **↺ Positive** / **↺ Negative** restore embedded text independently. Missing negatives are empty strings. Edits are stored in the workflow and never written to PNGs.
- **Delete** clears the card selection, image preview, prompt fields, and overrides in both card nodes. It preserves `library_root` and never deletes files. Empty nodes output empty strings, including when the library is unavailable. The cleared state survives Refresh/workflow restoration; selecting another card resumes normal behavior. Changing the root permits its initial-card selection again.
- Library opening and workflow restoration preserve edits for the same source. **Refresh** rereads disk metadata, clears metadata/thumbnail caches, replaces existing local edits, and disables overrides. New typing after a request starts is protected. Switching variants also clears edits; edits are not remembered per variant.
- Dropping a PNG matches it inside the configured library; browsers do not reveal its original folder. This does not import the file.
- Metadata scanning skips pixel chunks. Cached thumbnails are generated on demand (up to 320 × 448, 128 entries). Card preview height grows within 160–640 pixels; enlargement may look softer. Performance is not benchmarked.

## Plain concatenation

**Concatenate · x3** and **Concatenate · x4** join A/B/C or A/B/C/D exactly with a shared delimiter at every boundary, including empty inputs. No cleanup, switches, Advanced variants, or Preview. Underscores, commas, whitespace and duplicates are preserved. For cleanup, pass the result to Anima Advanced with its other input and delimiter empty. Image prompt reconstruction supports both nodes.

Former Anima 3 IDs remain registered as deprecated compatibility nodes with their original cleanup behavior, preserving saved workflows and PNG reconstruction. Use x3/x4 for new workflows.

## Concatenate · Anima

The two-input nodes join `string_a + delimiter + string_b`, then convert underscores to spaces. Convert string widgets to inputs to connect upstream nodes. Delimiter defaults to empty; use `, ` for tag lists. A single string can be normalized with the other input and delimiter empty.

The simple node always preserves standalone `score_1`–`score_9` and cleans empty top-level comma fields. Advanced exposes `preserve_score_tags` and `clean_commas`, both initially on. Cleanup removes leading/trailing/repeated top-level commas and trims field boundaries, retaining order, repeated tags, weights, nested syntax, and escaped commas. With cleanup off, delimiters/whitespace remain exact. Underscores in other identifiers are also converted: use this for prompt text intended for conversion.

Advanced **Preview** shows its exact string from the last execution. Opening it does not evaluate upstream nodes; execute again after edits. The simple node has no preview. Existing configurable nodes retain their internal ID and now appear as Advanced.

The Anima model card recommends spaces for regular tags and underscores for score tags. This is formatting support, not a measured image-quality improvement or a tokenizer guarantee. [Anima reference](https://huggingface.co/circlestone-labs/Anima#prompting).

## Load Image + Prompts

Use **Choose file to upload** to select a local file through the browser, or choose an existing input image from the native image list. Prompts and extraction status load immediately. Image/mask conversion delegates to the installed built-in LoadImage. Only the native image preview is shown.

- `replace_underscores`, `preserve_score_tags`, and `clean_commas` control both outputs and default on. These cannot undo transformations already applied by the original generation graph.
- Typing enables independent `use_edited_positive` / `use_edited_negative` flags. Cleanup also applies to edited output. Refresh rereads metadata and replaces both edits; changing images clears them. Same-image workflow restoration preserves edits.
- Editable fields remain inputs; execution does not replace them with processed outputs. Preview shows the executed result. Both overrides may be enabled to supply prompts manually even if the saved graph cannot be read. New edits made during a pending refresh are preserved.
- New nodes start with an empty image selection. **Delete** clears the image, prompts, and previews while keeping the folder and files. Select another image before running this node.
- **Refresh**, **Preview**, and **Delete** share a row. Preview shows the exact positive/negative strings from this node's last execution, including edits and cleanup. It updates while open. It is not a live upstream evaluation or a reader of the newly generated output image. Runtime snapshots are not saved in workflow files.
- Extraction prioritizes sampler connections over partial Positive Prompt titles. It supports chained built-in/Anima concatenators, saved Cardbooru text, primitive strings, common encoders/conditioning wrappers, and guiders. Unknown nodes, cycles, and unresolvable paths report errors rather than silently returning partial text.
- With several sampling stages, status lists IDs and the selected first sampler. `sampler_id` is an advanced widget and retains saved values. Show advanced widgets to choose another stage. Conditioning merges are listed with a warning, not represented as equivalent conditioning math.
- Supported metadata: execution `prompt` JSON or A1111 `parameters`. PNG text scanning includes compressed/post-IDAT chunks without decoding pixels. Other supported image formats use available Pillow text metadata; lost metadata and a visual `workflow` alone cannot restore runtime text.
- Cardbooru outputs reconstructed from saved widgets with overrides off are explicitly flagged as snapshots: the exact original external-card output may not have been stored. Missing snapshots cannot be guessed. No external card path is reopened.

DOM buttons use shared dark theme-aware styling. The upload button uses the native browser file chooser.

## Reporting issues

When opening a GitHub issue, include your ComfyUI and frontend versions, the affected node, steps to reproduce the issue, and any relevant error messages.
