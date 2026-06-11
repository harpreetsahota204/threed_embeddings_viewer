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

import numpy as np

import fiftyone.operators as foo

_PLUGIN_URI = "@harpreetsahota/threed-embeddings"

# Selections of at most this many samples are applied client-side as a
# Select stage (read-only, like always). Larger selections are applied as
# a dataset tag + MatchTags stage, since materializing huge id lists in a
# view stage breaks the session/view bar/MongoDB
_SELECTION_ID_THRESHOLD = 10000

# Must match SELECTION_TAG in src/usePlotSelection.tsx
_SELECTION_TAG = "3d-embeddings-selection"

# Ids per select() batch when bulk-tagging (keeps each $in well under
# MongoDB's command document limit)
_TAG_WRITE_BATCH = 50000

# Points per geometry chunk. Each chunk is ~2-3 MB of base64 float32
# (x/y/z), small enough to keep individual trigger payloads snappy while
# large datasets stream in a few dozen messages
_GEOMETRY_CHUNK_SIZE = 250000

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


def _encode_f32(values):
    """Encodes a 1D array as base64 little-endian float32 bytes."""
    arr = np.ascontiguousarray(values, dtype="<f4")
    return base64.b64encode(arr.tobytes()).decode("ascii")


def _encode_i32(values):
    """Encodes a 1D array as base64 little-endian int32 bytes."""
    arr = np.ascontiguousarray(values, dtype="<i4")
    return base64.b64encode(arr.tobytes()).decode("ascii")


class LoadVisualizationResults(foo.Operator):
    """Stream visualization geometry from FiftyOne Brain results.

    Geometry is sent as base64 float32 chunks (a meta trigger followed by
    ``set_plot_data_chunk`` triggers): O(1) decode on the client and ~5x
    smaller than JSON number arrays. Sample ids are intentionally NOT
    sent — they dominate the payload and the frontend works purely in
    point indices, resolving ids server-side on demand (hover, selection).

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
            unlisted=True,
            execute_as_generator=True,
        )

    def execute(self, ctx):
        brain_key = ctx.params.get("brain_key")
        # Echoed in every trigger so the frontend can discard chunks from
        # a superseded stream (eg after a quick brain-key switch)
        source = f"{ctx.dataset.name}::{brain_key}"

        try:
            results = _load_brain_results(ctx.dataset, brain_key)

            points = results.points
            num_dims = points.shape[1]
            if num_dims < 2:
                raise ValueError(
                    f"Brain key '{brain_key}' has {num_dims}D embeddings; "
                    "at least 2 dimensions are required."
                )

            count = len(points)
            num_chunks = max(
                1, -(-count // _GEOMETRY_CHUNK_SIZE)  # ceil division
            )

            yield ctx.trigger(
                f"{_PLUGIN_URI}/set_plot_data_meta",
                params={
                    "source": source,
                    "count": count,
                    "num_dims": num_dims,
                    "num_chunks": num_chunks,
                },
            )

            for chunk_index in range(num_chunks):
                start = chunk_index * _GEOMETRY_CHUNK_SIZE
                end = min(count, start + _GEOMETRY_CHUNK_SIZE)
                params = {
                    "source": source,
                    "chunk_index": chunk_index,
                    "num_chunks": num_chunks,
                    "start": start,
                    "size": end - start,
                    "x": _encode_f32(points[start:end, 0]),
                    "y": _encode_f32(points[start:end, 1]),
                }
                # 2D embeddings render as a flat plane (z stays zeroed
                # client-side); skipping z saves a third of the payload
                if num_dims >= 3:
                    params["z"] = _encode_f32(points[start:end, 2])

                yield ctx.trigger(
                    f"{_PLUGIN_URI}/set_plot_data_chunk", params=params
                )
        except Exception as e:
            yield ctx.trigger(
                f"{_PLUGIN_URI}/set_plot_error", params={"error": str(e)}
            )


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
            raw_values = _values_in_brain_order(
                ctx.dataset, results, color_by
            )
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
        n = len(sample_ids)
        bitmask = bytearray((n + 7) // 8)
        in_view = np.isin(sample_ids, list(view_ids))
        for i in np.flatnonzero(in_view):
            bitmask[i >> 3] |= 1 << (i & 7)

        return {"in_view": base64.b64encode(bytes(bitmask)).decode("ascii")}


def _get_index_map(results):
    """Returns (and caches on the results object) the id -> point index
    map for a brain run. Built once per cached results object."""
    index_map = getattr(results, "_plugin_index_map", None)
    if index_map is None:
        index_map = {
            sample_id: i for i, sample_id in enumerate(results.sample_ids)
        }
        results._plugin_index_map = index_map

    return index_map


def _field_value_at_index(dataset, results, index, field):
    """Returns one sample's ``field`` value in brain-result order."""
    if not 0 <= index < len(results.sample_ids):
        return None
    sample_id = results.sample_ids[index]
    try:
        values = dataset.select([sample_id]).values(field)
        return values[0] if values else None
    except Exception:
        return None


class GetSampleInfo(foo.Operator):
    """Resolve a point index to its sample id, filepath, and hover lines.

    Looked up per hover (and cached client-side) rather than shipping all
    ids/filepaths/labels with the plot data, which does not scale to large
    datasets. Optional ``color_by`` returns the same hover lines that
    ``get_plot_colors`` used to ship for every point.
    """

    @property
    def config(self):
        return foo.OperatorConfig(
            name="get_sample_info",
            label="Get Sample Info",
            description="Get the sample id and filepath for a point",
            unlisted=True,
        )

    def execute(self, ctx):
        brain_key = ctx.params.get("brain_key")
        index = ctx.params.get("index")
        color_by = ctx.params.get("color_by")
        empty = {"sample_id": None, "filepath": None, "hover_lines": None}

        if brain_key is None or index is None:
            return empty

        results = _load_brain_results(ctx.dataset, brain_key)
        if not 0 <= index < len(results.sample_ids):
            return empty

        sample_id = results.sample_ids[index]
        debug = None
        try:
            filepath, debug = _resolve_media_url(ctx.dataset, sample_id)
        except KeyError:
            # Sample deleted since the brain run
            filepath = None
            debug = {"error": "sample deleted since brain run (KeyError)"}

        hover_lines = None
        if color_by:
            raw = _field_value_at_index(ctx.dataset, results, index, color_by)
            _, hover_lines = _summarize(raw)

        return {
            "sample_id": sample_id,
            "filepath": filepath,
            "hover_lines": hover_lines,
            "_debug": debug,
        }


class GetSampleIndices(foo.Operator):
    """Resolve sample ids to point indices (eg the grid's checked
    samples, which the frontend only knows by id). Ids not in the brain
    run are skipped.
    """

    @property
    def config(self):
        return foo.OperatorConfig(
            name="get_sample_indices",
            label="Get Sample Indices",
            description="Map sample ids to point indices",
            unlisted=True,
        )

    def execute(self, ctx):
        brain_key = ctx.params.get("brain_key")
        sample_ids = ctx.params.get("sample_ids") or []
        if not brain_key:
            return {"indices": []}

        results = _load_brain_results(ctx.dataset, brain_key)
        index_map = _get_index_map(results)

        # The crash "unhashable type: 'list'" means some elements of
        # sample_ids are not strings (eg lists/objects). Capture the exact
        # shape into _debug (surfaced to the browser console) and only look
        # up hashable string ids so we don't 500 while diagnosing.
        non_string = [s for s in sample_ids if not isinstance(s, str)]
        debug = {
            "received_count": len(sample_ids),
            "non_string_count": len(non_string),
            "non_string_samples": [
                {"type": type(s).__name__, "value": s} for s in non_string[:5]
            ],
            "first_five": sample_ids[:5],
        }

        indices = [
            index_map[sample_id]
            for sample_id in sample_ids
            if isinstance(sample_id, str) and sample_id in index_map
        ]
        return {"indices": indices, "_debug": debug}


class ApplySelection(foo.Operator):
    """Resolve and apply a plot selection entirely server-side.

    The frontend never materializes large id lists: lassos send the
    polygon + camera matrices and classes send the field + label, and the
    matching is done here against the brain results. Small selections
    (<= ``_SELECTION_ID_THRESHOLD``) return ids for the frontend to apply
    as a Select view stage, exactly as before. Larger selections are
    written as a dataset tag and the frontend applies a constant-size
    MatchTags stage instead.

    Kinds:
        lasso:  {brain_key, lasso: {polygon, matrix, rect}}
        class:  {brain_key, color_by, label} (presence semantics)
        toggle: {brain_key, index, current_ids} — current_ids is the
                small-tier id list (or [] for no selection); null means
                the current selection is tag-tier
        clear:  {} (removes the selection tag)

    Returns ``{count, sample_ids, indices}`` (small tier) or
    ``{count, tag}`` (tag tier). The frontend works in point indices;
    ids appear only inside Select view stages.
    """

    @property
    def config(self):
        return foo.OperatorConfig(
            name="apply_selection",
            label="Apply Plot Selection",
            description="Resolve and apply a 3D plot selection",
            unlisted=True,
        )

    def execute(self, ctx):
        kind = ctx.params.get("kind")

        if kind == "clear":
            _clear_selection_tag(ctx.dataset)
            return {"count": 0}

        brain_key = ctx.params.get("brain_key")
        results = _load_brain_results(ctx.dataset, brain_key)

        if kind == "toggle":
            return _toggle_selection(
                ctx.dataset,
                results,
                ctx.params.get("index"),
                ctx.params.get("current_ids"),
            )

        if kind == "lasso":
            indices = _resolve_lasso(results, ctx.params.get("lasso"))
        elif kind == "class":
            indices = _resolve_class(
                ctx.dataset,
                results,
                ctx.params.get("color_by"),
                ctx.params.get("label"),
            )
        else:
            raise ValueError(f"Unknown selection kind '{kind}'")

        # Any new selection supersedes a previous tag-tier selection
        _clear_selection_tag(ctx.dataset)

        count = len(indices)
        debug = {"kind": kind, "count": count}
        if count <= _SELECTION_ID_THRESHOLD:
            sample_ids = [results.sample_ids[i] for i in indices]
            return {
                "count": count,
                "sample_ids": sample_ids,
                "indices": indices,
                "_debug": debug,
            }

        _write_selection_tag(
            ctx.dataset, [results.sample_ids[i] for i in indices]
        )
        return {"count": count, "tag": _SELECTION_TAG, "_debug": debug}


def _projection_matrix(values):
    """Builds a numpy matrix from a column-major 4x4 matrix (gl-matrix
    layout, as exposed by deck.gl's ``viewport.viewProjectionMatrix``)
    such that ``matrix @ vec`` matches deck's projection math."""
    return np.asarray(values, dtype=float).reshape(4, 4).T


def _resolve_lasso(results, lasso):
    """Returns the point indices whose projected screen positions fall
    inside the lasso polygon.

    Same math as deck.gl's ``viewport.project``, vectorized over all
    points: data coords are projected through the scene's
    view-projection matrix, perspective-divided into NDC, and mapped into
    the canvas client rect. deck uses raw data coordinates (no separate
    data scale), so a single matrix fully describes the transform.
    """
    points = np.asarray(results.points, dtype=float)
    n = len(points)

    # First 3 dims are what the frontend plots; 2D renders at z=0
    xyz = np.zeros((n, 3))
    xyz[:, 0] = points[:, 0]
    xyz[:, 1] = points[:, 1]
    if points.shape[1] >= 3:
        xyz[:, 2] = points[:, 2]

    rect = lasso["rect"]
    matrix = _projection_matrix(lasso["matrix"])

    homo = np.column_stack([xyz, np.ones(n)])
    projected = homo @ matrix.T
    w = projected[:, 3]

    with np.errstate(divide="ignore", invalid="ignore"):
        sx = rect["left"] + (0.5 + 0.5 * projected[:, 0] / w) * rect["width"]
        sy = rect["top"] + (0.5 - 0.5 * projected[:, 1] / w) * rect["height"]

    inside = _points_in_polygon(sx, sy, lasso["polygon"])
    inside &= w > 0  # Behind the camera

    return np.flatnonzero(inside).astype(int).tolist()


def _points_in_polygon(x, y, polygon):
    """Vectorized ray-casting point-in-polygon test (same semantics as
    the frontend's pointInPolygon)."""
    inside = np.zeros(len(x), dtype=bool)
    vertices = [(float(p["x"]), float(p["y"])) for p in polygon]

    j = len(vertices) - 1
    with np.errstate(divide="ignore", invalid="ignore"):
        for i in range(len(vertices)):
            xi, yi = vertices[i]
            xj, yj = vertices[j]
            crosses = (yi > y) != (yj > y)
            # Where crosses is False the division may be inf/nan; the
            # comparison is then False, matching the scalar short-circuit
            xcross = (xj - xi) * (y - yi) / (yj - yi) + xi
            inside ^= crosses & (x < xcross)
            j = i

    return inside


def _values_in_brain_order(dataset, results, field):
    """Returns per-sample values of ``field`` in brain-result order.

    One unordered values() fetch + dict reorder. Embedding the run's ids
    in select(ordered=True) does not scale: the ids blow up the
    aggregation pipeline and ordered selection is effectively quadratic
    in MongoDB. Samples since deleted from the dataset yield ``None``
    rather than silently misaligning the output.
    """
    ids, values = dataset.values(["id", field])
    values_by_id = dict(zip(ids, values))
    return [values_by_id.get(_id) for _id in results.sample_ids]


def _resolve_class(dataset, results, color_by, label):
    """Returns the point indices whose ``color_by`` value CONTAINS
    ``label`` (presence semantics, matching the legend counts)."""
    raw_values = _values_in_brain_order(dataset, results, color_by)
    return [
        i
        for i, value in enumerate(raw_values)
        if label in _presence_labels(value)
    ]


def _clear_selection_tag(dataset):
    dataset.match_tags(_SELECTION_TAG).untag_samples(_SELECTION_TAG)


def _write_selection_tag(dataset, sample_ids):
    # Batched so each select() pipeline stays well under MongoDB's
    # command document limit
    for start in range(0, len(sample_ids), _TAG_WRITE_BATCH):
        batch = sample_ids[start : start + _TAG_WRITE_BATCH]
        dataset.select(batch).tag_samples(_SELECTION_TAG)


def _toggle_selection(dataset, results, index, current_ids):
    """Adds/removes one point (by index) from the current selection.

    ``current_ids`` is the frontend's small-tier id list ([] when there
    is no selection); ``None`` means the selection is tag-tier and
    membership lives in the dataset tag.
    """
    if index is None or not 0 <= index < len(results.sample_ids):
        return {"count": 0}

    sample_id = results.sample_ids[index]

    if current_ids is None:
        # Tag tier: toggle membership in the dataset tag
        sample = dataset[sample_id]
        if _SELECTION_TAG in sample.tags:
            dataset.select([sample_id]).untag_samples(_SELECTION_TAG)
        else:
            dataset.select([sample_id]).tag_samples(_SELECTION_TAG)

        count = dataset.match_tags(_SELECTION_TAG).count()
        if count == 0:
            return {"count": 0}
        return {"count": count, "tag": _SELECTION_TAG}

    # Small tier: toggle in the id list
    ids = list(current_ids)
    if sample_id in ids:
        ids.remove(sample_id)
    else:
        ids.append(sample_id)

    if not ids:
        return {"count": 0}

    if len(ids) > _SELECTION_ID_THRESHOLD:
        _clear_selection_tag(dataset)
        _write_selection_tag(dataset, ids)
        return {"count": len(ids), "tag": _SELECTION_TAG}

    index_map = _get_index_map(results)
    return {
        "count": len(ids),
        "sample_ids": ids,
        "indices": [index_map[_id] for _id in ids],
    }


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

    Returns a dict shaped for the frontend. Per-point hover lines are NOT
    included — they are resolved lazily by ``get_sample_info``. Numeric
    per-point arrays are base64-encoded typed buffers (not JSON lists).

        continuous:  {count, colors_b64, color_scheme}
        categorical: {count, categories, class_indices_b64, class_members,
                      color_scheme}
    """
    summaries = [_summarize(v) for v in raw_values]
    class_values = [s[0] for s in summaries]
    count = len(raw_values)

    is_numeric = any(_is_number(v) for v in class_values) and all(
        v is None or _is_number(v) for v in class_values
    )
    if is_numeric:
        colors = np.array(
            [v if v is not None else 0 for v in class_values], dtype="<f4"
        )
        return {
            "count": count,
            "colors_b64": _encode_f32(colors),
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

    class_indices = np.array(
        [index_map[label] for label in dominant], dtype="<i4"
    )
    return {
        "count": count,
        "color_scheme": "categorical",
        "categories": [
            {"label": label, "color": palette[i], "count": presence_count}
            for i, (label, presence_count) in enumerate(ordered)
        ],
        "class_indices_b64": _encode_i32(class_indices),
        "class_members": [
            [index_map[label] for label in sample_labels]
            for sample_labels in members
        ],
    }


def _resolve_media_url(dataset, sample_id):
    """Resolve a sample's filepath to a browser-loadable media URL.

    For cloud-backed datasets the raw filepath is a ``gs://``/``s3://``
    URI that the browser cannot load. Enterprise resolves these to signed
    HTTPS URLs via the same server code path the grid uses
    (``_create_media_urls``); on open source the raw local/path is
    returned and the App serves it through the ``/media`` proxy. Falls
    back to the raw filepath if resolution is unavailable.

    Returns ``(url, debug)``. ``debug`` is a small dict describing what
    happened server-side, surfaced to the browser console for debugging
    (it never changes the resolved url).
    """
    import traceback as _traceback

    debug = {
        "raw_filepath": None,
        "signing_attempted": False,
        "signed": False,
        "resolved_url": None,
        "error": None,
    }

    sample = dataset[sample_id]
    filepath = sample.filepath
    debug["raw_filepath"] = filepath

    try:
        import fiftyone.core.media as fom
        import fiftyone.server.metadata as fosm

        debug["signing_attempted"] = True
        media_type = fom.get_media_type(filepath)
        _, _, media_urls = fosm._create_media_urls(
            dataset, sample.to_mongo_dict(), media_type, cache={}
        )
        debug["media_urls"] = media_urls
        for entry in media_urls:
            if entry.get("field") == "filepath" and entry.get("url"):
                debug["signed"] = True
                debug["resolved_url"] = entry["url"]
                return entry["url"], debug
    except Exception as e:
        debug["error"] = (
            "".join(_traceback.format_exception_only(type(e), e)).strip()
        )
        debug["traceback"] = _traceback.format_exc()

    debug["resolved_url"] = filepath
    return filepath, debug


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
    plugin.register(GetSampleInfo)
    plugin.register(GetSampleIndices)
    plugin.register(ApplySelection)
