# Embeddings Viewer Panel for FiftyOne

<div align="center">
<p align="center">

<!-- prettier-ignore -->
<img src="https://user-images.githubusercontent.com/25985824/106288517-2422e000-6216-11eb-871d-26ad2e7b1e59.png" height="55px"> &nbsp;
<img src="https://user-images.githubusercontent.com/25985824/106288518-24bb7680-6216-11eb-8f10-60052c519586.png" height="50px">

**The open-source tool for building high-quality datasets and computer vision
models**

---

<!-- prettier-ignore -->
<a href="https://voxel51.com/fiftyone?utm_source=harpreet-gh">Website</a> •
<a href="https://docs.voxel51.com?utm_source=harpreet-gh">Docs</a> •
<a href="https://colab.research.google.com/github/voxel51/fiftyone-examples/blob/master/examples/quickstart.ipynb?utm_source=harpreet-gh">Try it Now</a> •
<a href="https://docs.voxel51.com/getting_started_guides/index.html?utm_source=harpreet-gh">Getting Started Guides</a> •
<a href="https://docs.voxel51.com/tutorials/index.html?utm_source=harpreet-gh">Tutorials</a> •
<a href="https://voxel51.com/blog/?utm_source=harpreet-gh">Blog</a> •
<a href="https://discord.gg/fiftyone-community?utm_source=harpreet-gh">Community</a>

[![Discord](https://img.shields.io/badge/Discord-7289DA?logo=discord&logoColor=white)](https://discord.gg/fiftyone-community)
[![Hugging Face](https://img.shields.io/badge/Hugging_Face-purple?style=flat&logo=huggingface)](https://huggingface.co/Voxel51)
[![Voxel51 Blog](https://img.shields.io/badge/Voxel51_Blog-ff6d04?style=flat)](https://voxel51.com/blog)
[![Newsletter](https://img.shields.io/badge/Newsletter-BE5B25?logo=mail.ru&logoColor=white)](https://share.hsforms.com/1zpJ60ggaQtOoVeBqIZdaaA2ykyk)
[![LinkedIn](https://img.shields.io/badge/In-white?style=flat&label=Linked&labelColor=blue)](https://www.linkedin.com/company/voxel51)
[![Twitter](https://img.shields.io/badge/Twitter-000000?logo=x&logoColor=white)](https://x.com/voxel51)
[![Medium](https://img.shields.io/badge/Medium-12100E?logo=medium&logoColor=white)](https://medium.com/voxel51)

</p>
</div>

![image](threed_emb.gif)


An interactive embeddings visualization panel for the
[FiftyOne App](https://github.com/voxel51/fiftyone) that renders 2D **and
3D** embeddings, with lasso selection, hover image previews, and a rich
class legend.

## Highlights

- **2D and 3D embeddings** in one panel — 3D point clouds you can orbit
  and zoom; 2D embeddings render as a clean top-down plot. Higher
  dimensional results show their first three dimensions.

- **Hover previews** — point at any sample to see its image thumbnail and
  its color-by values.

- **Lasso + click selection** — select a region or build a selection
  point by point; the sample grid filters to your selection via a view
  stage you can see (and remove) in the view bar.

- **Class legend** — per-class counts with sidebar-style "samples
  containing" semantics, click to highlight classes, shift-click to
  filter the grid to a class. Drag it anywhere, collapse it when you
  don't need it.

- **View-aware** — sidebar filters dim out-of-view points and the legend
  counts update to `in view / total`.

## Installation

```bash
# Clone into your FiftyOne plugins directory
fiftyone plugins download https://github.com/harpreetsahota204/threed-embeddings
```

## Getting started

1. Compute an embeddings visualization with
   [FiftyOne Brain](https://docs.voxel51.com/brain.html) — 2D or 3D:

   ```python
   import fiftyone as fo
   import fiftyone.brain as fob

   dataset = fo.load_dataset("my-dataset")
   fob.compute_visualization(dataset, brain_key="viz3d", num_dims=3)
   ```

2. Open the App, add the **3D Embeddings** panel (the `+` next to the
   Samples tab), and pick your brain key.

3. Optionally pick a **Color by** field — classification labels,
   detection labels, numeric fields, confidences, etc.

## Using the panel

The panel has two modes, switched by **double-clicking** the plot (or the
`Select` button):

| | Explore (default, grab cursor) | Select (pointer cursor) |
|---|---|---|
| Drag | orbit the cloud | draw a lasso |
| Scroll | zoom | zoom |
| Click a point | nothing (no accidental filtering) | toggle it in/out of the selection |
| Hover | thumbnail + values | thumbnail + values |
| Esc | clear selection + highlights | exit select mode |

### Selection

- **Lasso** a region to select it (replaces the current selection);
  **click** points to add/remove them one at a time.

- The sample grid filters to your selection through a `Select` stage in
  the view bar — it survives panel hiding and App refreshes, and you can
  remove it from the view bar like any stage.

- The selection count appears on the panel tab; click it there to clear.

### Color by & hover

- Samples with multiple labels (e.g. detections) are colored by their
  **most common** label; numeric lists (e.g. confidences) use the
  **mean**.

- The hover card shows the full breakdown, e.g.:

  ```
  cat: 3
  dog: 2
  1 other object
  ```

### Legend

For categorical fields the legend lists every class with its color and
the number of samples **containing** it (same semantics as sidebar label
filters — counts can overlap):

- **Click** a class to highlight its samples (click more classes to build
  up; click again to remove)

- **Shift-click** a class to filter the sample grid to it
- Drag the legend header to move it; use the chevron to collapse it
- With filters active, counts show `in view / total`

For numeric fields the legend is a viridis gradient with the field's
min/max.

### Buttons

- **Select / Selecting** — toggle selection mode (same as double-click)

- **Reset View** — return the camera to the default angle (top-down for
  2D embeddings)


## License

Apache 2.0
