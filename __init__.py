"""
3D Embeddings Viewer Plugin for FiftyOne.

| Copyright 2017-2026, Voxel51, Inc.
| `voxel51.com <https://voxel51.com/>`_
|
"""

import colorsys

import fiftyone.operators as foo
import fiftyone.operators.types as types


class LoadVisualizationResults(foo.Operator):
    """Load 3D visualization results from FiftyOne Brain."""

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

        inputs.str(
            "color_by",
            label="Color By",
            description="Field to use for point colors",
            required=False,
        )

        return types.Property(inputs)

    def execute(self, ctx):
        brain_key = ctx.params.get("brain_key")
        color_by = ctx.params.get("color_by")

        try:
            results = ctx.dataset.load_brain_results(brain_key)

            num_dims = results.points.shape[1]
            if num_dims != 3:
                raise ValueError(
                    f"Brain key '{brain_key}' has {num_dims}D embeddings. "
                    "This panel requires 3D embeddings (num_dims=3)."
                )

            data = self._prepare_plot_data(ctx, results, color_by)
        except Exception as e:
            ctx.trigger(
                "@harpreetsahota/threed-embeddings/set_plot_error",
                params={"error": str(e)},
            )
            return {"error": str(e)}

        ctx.trigger(
            "@harpreetsahota/threed-embeddings/set_plot_data",
            params={"plot_data": data},
        )
        return {}

    def _prepare_plot_data(self, ctx, results, color_by):
        points = results.points
        sample_ids = list(results.sample_ids)
        view = ctx.dataset.select(sample_ids, ordered=True)

        data = {
            "x": points[:, 0].tolist(),
            "y": points[:, 1].tolist(),
            "z": points[:, 2].tolist(),
            "sample_ids": sample_ids,
            "filepaths": view.values("filepath"),
        }

        if color_by:
            labels, colors, scheme = self._compute_colors(view, color_by)
        else:
            labels = [sid[:8] for sid in sample_ids]
            colors = ["#1f77b4"] * len(sample_ids)
            scheme = "uniform"

        data["labels"] = labels
        data["colors"] = colors
        data["color_scheme"] = scheme
        return data

    def _compute_colors(self, view, color_field):
        """Computes per-sample labels and colors for ``color_field``."""
        values = [_flatten(v) for v in view.values(color_field)]

        labels = [str(v) if v is not None else "None" for v in values]

        is_numeric = any(_is_number(v) for v in values) and all(
            v is None or _is_number(v) for v in values
        )
        if is_numeric:
            numeric_values = [v if v is not None else 0 for v in values]
            return labels, numeric_values, "continuous"

        unique_labels = sorted(set(labels))
        palette = _generate_color_palette(len(unique_labels))
        color_map = dict(zip(unique_labels, palette))
        colors = [color_map[label] for label in labels]
        return labels, colors, "categorical"


class GetViewSamples(foo.Operator):
    """Get sample IDs that are in the current filtered view.

    This is used to determine which points should be dimmed in the 3D plot
    when filters or view stages are applied.
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
        if not brain_key:
            return {"sample_ids": []}

        results = ctx.dataset.load_brain_results(brain_key)
        brain_sample_ids = set(results.sample_ids)
        view_ids = ctx.view.values("id")

        return {
            "sample_ids": [i for i in view_ids if i in brain_sample_ids]
        }


def _flatten(value):
    """Reduces list values (eg detections label lists) to a scalar."""
    while isinstance(value, (list, tuple)):
        value = value[0] if value else None

    return value


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
    plugin.register(GetViewSamples)
