"""
3D Embeddings Viewer Plugin for FiftyOne.

| Copyright 2017-2026, Voxel51, Inc.
| `voxel51.com <https://voxel51.com/>`_
|
"""

import colorsys
from collections import Counter

import fiftyone.operators as foo
import fiftyone.operators.types as types

_PLUGIN_URI = "@harpreetsahota/threed-embeddings"


class LoadVisualizationResults(foo.Operator):
    """Load 3D visualization geometry from FiftyOne Brain results.

    Colors are intentionally not included; they are fetched separately by
    ``get_plot_colors`` so that recoloring does not re-transfer geometry.
    """

    @property
    def config(self):
        return foo.OperatorConfig(
            name="load_visualization_results",
            label="Load 3D Visualization Results",
            description="Load 3D embeddings visualization from brain results",
            dynamic=True,
            unlisted=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()

        if ctx.dataset is None:
            return types.Property(inputs)

        brain_keys = ctx.dataset.list_brain_runs(type="visualization")

        if not brain_keys:
            inputs.view(
                "warning",
                types.Warning(
                    label="No 3D visualizations found",
                    description=(
                        "Please compute 3D embeddings first using "
                        "fob.compute_visualization(dataset, num_dims=3)"
                    ),
                ),
            )
            return types.Property(inputs)

        inputs.enum(
            "brain_key",
            brain_keys,
            label="Brain Key",
            description="Select the visualization to load",
            required=True,
            default=brain_keys[0] if len(brain_keys) == 1 else None,
        )

        return types.Property(inputs)

    def execute(self, ctx):
        brain_key = ctx.params.get("brain_key")

        try:
            results = ctx.dataset.load_brain_results(brain_key)

            num_dims = results.points.shape[1]
            if num_dims != 3:
                raise ValueError(
                    f"Brain key '{brain_key}' has {num_dims}D embeddings. "
                    "This panel requires 3D embeddings (num_dims=3)."
                )

            points = results.points
            data = {
                "x": points[:, 0].tolist(),
                "y": points[:, 1].tolist(),
                "z": points[:, 2].tolist(),
                "sample_ids": list(results.sample_ids),
            }
        except Exception as e:
            ctx.trigger(
                f"{_PLUGIN_URI}/set_plot_error", params={"error": str(e)}
            )
            return {"error": str(e)}

        ctx.trigger(f"{_PLUGIN_URI}/set_plot_data", params={"plot_data": data})
        return {}


class GetPlotColors(foo.Operator):
    """Compute per-sample labels and colors for a color-by field."""

    @property
    def config(self):
        return foo.OperatorConfig(
            name="get_plot_colors",
            label="Get Plot Colors",
            description="Compute point colors for a field",
            unlisted=True,
        )

    def execute(self, ctx):
        brain_key = ctx.params.get("brain_key")
        color_by = ctx.params.get("color_by")

        try:
            results = ctx.dataset.load_brain_results(brain_key)
            view = ctx.dataset.select(list(results.sample_ids), ordered=True)
            plot_colors = _compute_colors(view, color_by)
        except Exception as e:
            ctx.trigger(
                f"{_PLUGIN_URI}/set_plot_error", params={"error": str(e)}
            )
            return {"error": str(e)}

        ctx.trigger(
            f"{_PLUGIN_URI}/set_plot_colors",
            params={"plot_colors": plot_colors},
        )
        return {}


class GetViewSamples(foo.Operator):
    """Get sample IDs that are in the current filtered view.

    This is used to determine which points should be dimmed in the 3D plot
    when filters or view stages are applied. When the view contains more
    than ``max_ids`` matching samples, no IDs are returned and the frontend
    skips dimming, avoiding multi-MB ID transfers on large datasets.
    """

    @property
    def config(self):
        return foo.OperatorConfig(
            name="get_view_samples",
            label="Get View Samples",
            description="Get sample IDs in current view for filtering visualization",
            unlisted=True,
        )

    def execute(self, ctx):
        brain_key = ctx.params.get("brain_key")
        max_ids = ctx.params.get("max_ids")
        if not brain_key:
            return {"sample_ids": []}

        results = ctx.dataset.load_brain_results(brain_key)
        brain_sample_ids = set(results.sample_ids)
        view_ids = ctx.view.values("id")
        matching = [i for i in view_ids if i in brain_sample_ids]

        if max_ids is not None and len(matching) > max_ids:
            return {"too_many": True, "count": len(matching)}

        return {"sample_ids": matching}


class GetSampleFilepath(foo.Operator):
    """Resolve a sample's filepath for the hover thumbnail.

    Looked up per hover (and cached client-side) rather than shipping all
    filepaths with the plot data, which does not scale to large datasets.
    """

    @property
    def config(self):
        return foo.OperatorConfig(
            name="get_sample_filepath",
            label="Get Sample Filepath",
            description="Get the filepath of a sample",
            unlisted=True,
        )

    def execute(self, ctx):
        sample_id = ctx.params.get("sample_id")
        if not sample_id:
            return {"filepath": None}

        try:
            return {"filepath": ctx.dataset[sample_id].filepath}
        except KeyError:
            return {"filepath": None}


def _compute_colors(view, color_field):
    """Computes the plot colors payload for ``color_field``.

    List values (eg per-detection labels/confidences) are aggregated per
    sample: mode for labels, mean for numbers. Hover labels carry the
    distribution as display lines (eg ["cat: 3", "dog: 2"]) while colors
    use the aggregate.

    Returns a dict shaped for the frontend:
        continuous:  {labels, colors (numbers), color_scheme}
        categorical: {labels, categories, class_indices, color_scheme}
    """
    summaries = [_summarize(v) for v in view.values(color_field)]
    class_values = [s[0] for s in summaries]
    hover_labels = [s[1] for s in summaries]

    is_numeric = any(_is_number(v) for v in class_values) and all(
        v is None or _is_number(v) for v in class_values
    )
    if is_numeric:
        return {
            "labels": hover_labels,
            "colors": [v if v is not None else 0 for v in class_values],
            "color_scheme": "continuous",
        }

    class_labels = [
        str(v) if v is not None else "None" for v in class_values
    ]
    ordered = _by_count(Counter(class_labels))
    palette = _generate_color_palette(len(ordered))
    index_map = {label: i for i, (label, _) in enumerate(ordered)}

    return {
        "labels": hover_labels,
        "color_scheme": "categorical",
        "categories": [
            {"label": label, "color": palette[i], "count": count}
            for i, (label, count) in enumerate(ordered)
        ],
        "class_indices": [index_map[label] for label in class_labels],
    }


def _summarize(value):
    """Returns ``(aggregate_value, hover_lines)`` for a raw field value.

    ``hover_lines`` is a list of display lines: for label lists, the top 4
    classes as ``label: count`` plus an ``N other objects`` line.
    """
    if not isinstance(value, (list, tuple)):
        return value, [str(value) if value is not None else "None"]

    items = _flatten_list(value)
    if not items:
        return None, ["None"]

    if all(_is_number(v) for v in items):
        mean = sum(items) / len(items)
        if len(items) == 1:
            return mean, [str(items[0])]
        return mean, [f"{mean:.3f} (mean of {len(items)})"]

    counts = _by_count(Counter(str(v) for v in items))
    mode = counts[0][0]

    lines = [f"{label}: {count}" for label, count in counts[:4]]
    others = sum(count for _, count in counts[4:])
    if others:
        lines.append(f"{others} other object{'s' if others > 1 else ''}")

    return mode, lines


def _by_count(counter):
    """Counter items sorted by count desc, then label, for determinism."""
    return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))


def _flatten_list(value):
    """Flattens nested lists, dropping Nones."""
    flat = []
    for item in value:
        if isinstance(item, (list, tuple)):
            flat.extend(_flatten_list(item))
        elif item is not None:
            flat.append(item)

    return flat


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _generate_color_palette(n):
    base_colors = [
        "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
        "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
    ]

    if n <= len(base_colors):
        return base_colors[:n]

    colors = []
    for i in range(n):
        rgb = colorsys.hsv_to_rgb(i / n, 0.7, 0.9)
        colors.append(
            f"#{int(rgb[0] * 255):02x}{int(rgb[1] * 255):02x}{int(rgb[2] * 255):02x}"
        )

    return colors


def register(plugin):
    plugin.register(LoadVisualizationResults)
    plugin.register(GetPlotColors)
    plugin.register(GetViewSamples)
    plugin.register(GetSampleFilepath)
