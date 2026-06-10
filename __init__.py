"""
3D Embeddings Viewer Plugin for FiftyOne.

| Copyright 2017-2026, Voxel51, Inc.
| `voxel51.com <https://voxel51.com/>`_
|
"""

import base64
import colorsys
import threading
from collections import Counter, OrderedDict

import fiftyone.operators as foo
import fiftyone.operators.types as types

_PLUGIN_URI = "@harpreetsahota/threed-embeddings"

_BRAIN_RESULTS_CACHE_SIZE = 4
_brain_results_cache = OrderedDict()
_brain_results_lock = threading.Lock()


def _load_brain_results(dataset, brain_key):
    """Loads brain results with a small in-process LRU cache.

    Every operator here needs the brain results, and they are re-executed
    on each color-by/view change; loading multi-100k-point results from
    the database each time dominates latency. The cache key includes the
    run's timestamp, so recomputing a run under the same brain key
    invalidates the stale entry.
    """
    info = dataset.get_brain_info(brain_key)
    key = (dataset.name, brain_key, str(info.timestamp))

    with _brain_results_lock:
        if key in _brain_results_cache:
            _brain_results_cache.move_to_end(key)
            return _brain_results_cache[key]

    results = dataset.load_brain_results(brain_key)

    with _brain_results_lock:
        _brain_results_cache[key] = results
        _brain_results_cache.move_to_end(key)
        while len(_brain_results_cache) > _BRAIN_RESULTS_CACHE_SIZE:
            _brain_results_cache.popitem(last=False)

    return results


class LoadVisualizationResults(foo.Operator):
    """Load visualization geometry from FiftyOne Brain results.

    Embeddings of any dimensionality >= 2 are supported: the first three
    dimensions are visualized (matching the builtin Embeddings panel,
    which plots the first two), with 2D embeddings rendered as a flat
    plane viewed top-down.

    Colors are intentionally not included; they are fetched separately by
    ``get_plot_colors`` so that recoloring does not re-transfer geometry.
    """

    @property
    def config(self):
        return foo.OperatorConfig(
            name="load_visualization_results",
            label="Load 3D Visualization Results",
            description="Load embeddings visualization from brain results",
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
                    label="No visualizations found",
                    description=(
                        "Please compute embeddings first using "
                        "fob.compute_visualization(dataset)"
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
            results = _load_brain_results(ctx.dataset, brain_key)

            points = results.points
            num_dims = points.shape[1]
            if num_dims < 2:
                raise ValueError(
                    f"Brain key '{brain_key}' has {num_dims}D embeddings; "
                    "at least 2 dimensions are required."
                )

            data = {
                "x": points[:, 0].tolist(),
                "y": points[:, 1].tolist(),
                # 2D embeddings render as a flat plane (viewed top-down)
                "z": points[:, 2].tolist()
                if num_dims >= 3
                else [0.0] * len(points),
                "sample_ids": list(results.sample_ids),
                "num_dims": num_dims,
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
            results = _load_brain_results(ctx.dataset, brain_key)

            # One unordered values() fetch + dict reorder. Embedding the
            # run's ids in select(ordered=True) does not scale: the ids
            # blow up the aggregation pipeline and ordered selection is
            # effectively quadratic in MongoDB. Samples since deleted
            # from the dataset color as "None" rather than silently
            # misaligning the colors array.
            ids, values = ctx.dataset.values(["id", color_by])
            values_by_id = dict(zip(ids, values))
            raw_values = [
                values_by_id.get(_id) for _id in results.sample_ids
            ]
            plot_colors = _compute_colors(raw_values)
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
    """Get which brain-run samples are in the current filtered view.

    This is used to determine which points should be dimmed in the 3D plot
    when filters or view stages are applied. The result is a base64
    bitmask in brain-result index order (1 bit per point), so the payload
    is n/8 bytes regardless of how many samples match — no cap needed,
    unlike shipping id lists.
    """

    @property
    def config(self):
        return foo.OperatorConfig(
            name="get_view_samples",
            label="Get View Samples",
            description="Get in-view bitmask for dimming the visualization",
            unlisted=True,
        )

    def execute(self, ctx):
        brain_key = ctx.params.get("brain_key")
        if not brain_key:
            return {"in_view": None}

        results = _load_brain_results(ctx.dataset, brain_key)
        view_ids = set(ctx.view.values("id"))

        sample_ids = results.sample_ids
        bitmask = bytearray((len(sample_ids) + 7) // 8)
        for i, sample_id in enumerate(sample_ids):
            if sample_id in view_ids:
                bitmask[i >> 3] |= 1 << (i & 7)

        return {"in_view": base64.b64encode(bytes(bitmask)).decode("ascii")}


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


def _compute_colors(raw_values):
    """Computes the plot colors payload from per-sample raw field values,
    given in brain-result order.

    List values (eg per-detection labels/confidences) are aggregated per
    sample: mode for labels, mean for numbers. Hover labels carry the
    distribution as display lines (eg ["cat: 3", "dog: 2"]) while colors
    use the aggregate.

    Categorical category counts use presence semantics (number of samples
    containing the class), matching how the App sidebar filters labels.
    Point colors still use the dominant (mode) class, since each point can
    only have one color.

    Returns a dict shaped for the frontend:
        continuous:  {labels, colors (numbers), color_scheme}
        categorical: {labels, categories, class_indices, class_members,
                      color_scheme}
    """
    summaries = [_summarize(v) for v in raw_values]
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

    # Unique classes present in each sample (presence semantics)
    members = [_presence_labels(v) for v in raw_values]
    # Dominant class per sample (point color)
    dominant = [str(v) if v is not None else "None" for v in class_values]

    presence_counts = Counter(
        label for sample_labels in members for label in sample_labels
    )
    ordered = _by_count(presence_counts)
    palette = _generate_color_palette(len(ordered))
    index_map = {label: i for i, (label, _) in enumerate(ordered)}

    return {
        "labels": hover_labels,
        "color_scheme": "categorical",
        "categories": [
            {"label": label, "color": palette[i], "count": count}
            for i, (label, count) in enumerate(ordered)
        ],
        "class_indices": [index_map[label] for label in dominant],
        "class_members": [
            [index_map[label] for label in sample_labels]
            for sample_labels in members
        ],
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


def _presence_labels(value):
    """Returns the sorted unique class labels present in a raw value."""
    if not isinstance(value, (list, tuple)):
        return [str(value) if value is not None else "None"]

    items = _flatten_list(value)
    if not items:
        return ["None"]

    return sorted({str(v) for v in items})


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
