# ComfyUI-Cardbooru

Browse PNG character cards in ComfyUI and reuse the prompts embedded in them. Pick a character, switch variants, and edit the prompt for your current workflow. The package also includes prompt concatenators and an image loader for recovering saved prompts.

Designed for ComfyUI portable on Windows. Comfy Desktop compatibility is being tested. The Cardbooru Desktop card editor is optional.

Download cards from the official [Cardbooru library](https://cardbooru.com/). <br>
Learn to use **Cardbooru · Positive + Negative** in the [how-to-use guide](https://cardbooru.com/how-to-use).

Find the nodes under **Cardbooru / Tools** and **Cardbooru / Concatenate** in the node menu.

## Installation

Extract the package as `ComfyUI-Cardbooru` inside the active ComfyUI installation's `custom_nodes` directory, or run this from that directory:

```powershell
git clone https://github.com/pyupi-labs/ComfyUI-Cardbooru.git
```

Restart ComfyUI and press Ctrl+F5 in the browser. If you have an older installation named `cardbooru_nodes`, replace it to avoid duplicate registrations.

For a Comfy Desktop test, use the `custom_nodes` directory of the local build you launch. Restart that build, configure `library_root`, and check that Library opens and a card can be selected. Open the Console in ComfyUI to review import errors.

## Tools

### Cardbooru · Positive + Negative

Select one card and get separate positive and negative `STRING` outputs. A card without a negative prompt returns an empty negative string. You can edit and reset each prompt independently.

### Cardbooru · Positive

Select a card and get its positive prompt as a `STRING`. Use this when your workflow supplies the negative prompt separately.

#### Using the card nodes

1. Set `library_root` to a folder on the ComfyUI server. The nodes search its subfolders and wait for a configured path when the field is empty. A full card PNG path uses that card's parent folder.
2. Click **Library** to search by character, variant, or series. You can also drop a PNG that already exists in the configured library.
3. Use the arrows to cycle through variants of the same character and series. **Base** jumps to the Base variant when available.
4. Connect the prompt output to a text encoder's string input. You can edit the prompt in the node, and the workflow saves the edit.

`use_edited_positive` and `use_edited_negative` start enabled where available. Turn a control off to use the corresponding prompt directly from the PNG. **↺ Positive** and **↺ Negative** restore the corresponding embedded text. **Refresh** rereads the selected card from disk and replaces local prompt edits. **Delete** clears the selection and prompt fields while keeping the library path and the PNG file. Enable `use_copyright` to insert the lowercase series tag after the character tag. It starts off and updates the positive editor immediately.

Card labels embedded in the PNG take priority over filenames. Filenames with spaces and legacy underscores are supported. Identical copies appear once. Cards with the same character, series, and variant but conflicting prompts are excluded with a warning.

### Cardbooru · Control Panel

**Cardbooru · Control Panel** reads the original filename from the connected **Load Diffusion Model** output at execution time. Connect its integer `steps` and float `cfg` and `denoise` outputs to your sampler. Connect the model to the sampler as usual. Switching models loads the selected preset for the new model, falling back to **Recommend** if the preset is unavailable. Selecting a preset fills steps and CFG. Both fields remain editable, and edits are saved with the workflow until you switch models or presets.

| Model | Recommend steps / CFG | Maximum steps / CFG | Personal |
| --- | --- | --- | --- |
| Anima Base v1.0 | 30 / 4 | 50 / 5 | |
| Anima Aesthetic v1.1 | 30 / 4 | 50 / 5 | |
| Anima Turbo v1.1 | 8 / 1 | 12 / 1 | 20 / 2 |

Aesthetic uses the general Anima guidance. Denoise is editable from 0.0 to 1.0 and defaults to 1.0 for generation. Use a separate setting for HiresFix refinement. **Personal** is only valid for Turbo. Enter steps and CFG directly when using a renamed model or a loader that cannot be identified.

### Cardbooru · Image Size

**Cardbooru · Image Size** provides `width` and `height` as integer outputs. Connect them to the corresponding inputs on a latent image node. Edit either dimension directly or click **Swap** to reverse the orientation.

**Presets** groups Anima-oriented sizes under **Speed**, **Good**, **Okay**, and **Heavy**. Each row shows the aspect ratio, first-pass dimensions, 1.25× dimensions, and first-pass megapixels. Selecting a row sets the first-pass size. The larger dimensions are a planning reference for a separate upscale step. The groups are practical workflow presets. See the [Anima model card](https://huggingface.co/circlestone-labs/Anima#user-content-generation-settings) for the model's resolution guidance.

### Cardbooru · Load Image + Prompts

Choose an image from the input list or use **Choose file to upload**. The node shows the image and recovered prompts, and outputs `IMAGE`, `MASK`, positive `STRING`, and negative `STRING`. You can leave the mask output disconnected.

Selecting an image loads its prompts automatically. Edits in either field are used automatically. Use `replace_underscores`, `preserve_score_tags`, and `clean_commas` to adjust both outputs. **Refresh** rereads the image metadata and replaces local edits. **Preview** shows the resulting positive and negative strings from the last execution. **Delete** clears the image selection and prompt fields.

The loader supports ComfyUI execution `prompt` metadata and A1111 `parameters`. It follows sampler connections through supported text and conditioning nodes. If an image contains several sampling stages, open the advanced options and use `sampler_id` to select the stage listed in the status. Unsupported nodes and missing metadata can limit recovery, and saved Cardbooru text may be reported as a snapshot.

## Concatenate

### Concatenate · Clean Advanced

Joins two strings using the chosen delimiter. Use `, ` for a comma-separated tag list. The node converts underscores to spaces and provides independent switches for `preserve_score_tags`, `clean_commas`, and `merge_character_counts`. All three options start enabled. **Preview** shows the exact string from the last execution. Run the workflow again to see the effect of edits.

### Concatenate · Clean

Joins two strings with the same cleanup defaults as **Clean Advanced**, with all cleanup options enabled. It preserves `score_1` through `score_9`, removes empty comma fields, and combines character-count tags. **Preview** shows the exact string from the last execution.

These two nodes were originally named **Concatenate · Anima** and **Concatenate · Anima Advanced**. Their internal IDs are unchanged, so existing workflows can still load them.

#### How character counts work

The nodes process standalone, comma-separated count tags independently for `girl`, `boy`, and `other`.

| Input | Output |
| --- | --- |
| `1girl, mei mei, 1girl, 1girl` | `3girls, mei mei` |
| `2girls, 1girl, 1girl` | `2girls` |
| `2boys, 2boys, 1other, 1other` | `2boys, 2others` |

A count generated from singles replaces the first singleton. An explicit plural count takes priority and stays where it first appeared. Identical plurals collapse to one, and different explicit totals such as `2girls, 3girls` are kept. Weighted and nested counts, prose, and other repeated tags are outside the count pass.

### Concatenate · x3

Joins three strings in A, B, C order using one delimiter between inputs. It preserves the input text, including empty inputs.

### Concatenate · x4

Joins four strings in A, B, C, D order the same way. To clean the result from either node, pass it to **Concatenate · Clean** or **Clean Advanced** with the second input and delimiter empty.

The deprecated **Concatenate · Anima 3** and **Concatenate · Anima 3 Advanced** nodes remain registered for older workflows. For new workflows, use **x3** followed by **Clean** or **Clean Advanced**.

## Reporting issues

Include your ComfyUI and frontend versions, the affected node, steps to reproduce the issue, and relevant error messages.
