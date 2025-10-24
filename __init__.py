"""
3D Embeddings Viewer Plugin for FiftyOne.

| Copyright 2017-2024, Voxel51, Inc.
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
                    description="Please compute 3D embeddings first using fob.compute_visualization(dataset, num_dims=3)"
                )
            )
            return types.Property(inputs)

        # Auto-select first brain key if not provided
        default_brain_key = brain_keys[0] if len(brain_keys) == 1 else None

        inputs.enum(
            "brain_key",
            brain_keys,
            label="Brain Key",
            description="Select the visualization to load",
            required=False,  # Not required - will use default if not provided
            default=default_brain_key,
        )

        inputs.enum(
            "color_by",
            self._get_color_fields(ctx.dataset),
            label="Color By",
            description="Field to use for point colors",
            default="None",
        )

        brain_key = ctx.params.get("brain_key", default_brain_key)
        if brain_key:
            results = ctx.dataset.load_brain_results(brain_key)
            inputs.view(
                "info",
                types.Notice(
                    label=f"Visualization: {len(results.sample_ids)} samples, {results.config.method} method, {results.points.shape[1]}D"
                )
            )

        return types.Property(inputs)

    def execute(self, ctx):
        brain_key = ctx.params.get("brain_key")
        color_by = ctx.params.get("color_by", "None")

        # If no brain_key provided, use the first available one
        if not brain_key:
            brain_keys = ctx.dataset.list_brain_runs(type="visualization")
            if not brain_keys:
                ctx.log("ERROR: No 3D visualizations found")
                return {"error": "No 3D visualizations found"}
            brain_key = brain_keys[0]
            ctx.log(f"Auto-selected brain key: {brain_key}")

        # Load brain results
        ctx.log(f"Loading brain results for key: {brain_key}")
        results = ctx.dataset.load_brain_results(brain_key)
        ctx.log(f"Brain results loaded. Points shape: {results.points.shape}")
        
        # Check if it's 3D
        if results.points.shape[1] != 3:
            ctx.log(f"ERROR: Brain key '{brain_key}' has {results.points.shape[1]}D embeddings, not 3D")
            return {"error": f"Brain key has {results.points.shape[1]}D embeddings, not 3D"}

        # Prepare data for React panel
        ctx.log(f"Preparing plot data with color_by: {color_by}")
        data = self._prepare_plot_data(ctx, results, color_by)
        ctx.log(f"Plot data prepared. Points: {len(data['x'])}")

        # Return data to be read by React panel
        result = {"plot_data": data}
        ctx.log(f"Returning result with keys: {list(result.keys())}")
        return result

    def _get_color_fields(self, dataset):
        """Get fields that can be used for coloring."""
        fields = ["None"]
        schema = dataset.get_field_schema()
        
        for field_name, field in schema.items():
            field_type = field.document_type.__name__ if hasattr(field, 'document_type') else str(type(field))
            
            if 'Classification' in field_type:
                fields.append(f"{field_name}.label")
            elif 'Detections' in field_type:
                fields.append(f"{field_name}.detections.label")
        
        for field_name, field in schema.items():
            if field.__class__.__name__ in ['IntField', 'FloatField']:
                fields.append(field_name)
        
        return fields

    def _prepare_plot_data(self, ctx, results, color_by):
        """Prepare plot data from brain results."""
        points = results.points
        sample_ids = results.sample_ids
        
        data = {
            "x": points[:, 0].tolist(),
            "y": points[:, 1].tolist(),
            "z": points[:, 2].tolist(),
            "sample_ids": sample_ids,
        }

        # Get labels and colors
        if color_by and color_by != "None":
            data["labels"], data["colors"], data["color_scheme"] = self._compute_colors(
                ctx, sample_ids, color_by
            )
        else:
            data["labels"] = [sid[:8] for sid in sample_ids]
            data["colors"] = ["#1f77b4"] * len(sample_ids)
            data["color_scheme"] = "uniform"

        return data

    def _compute_colors(self, ctx, sample_ids, color_field):
        """Compute colors for samples based on a field."""
        labels = []
        values = []
        
        for sample_id in sample_ids:
            sample = ctx.dataset[sample_id]
            
            value = sample
            for part in color_field.split('.'):
                value = getattr(value, part, None)
                if value is None:
                    break
            
            labels.append(str(value) if value is not None else "None")
            values.append(value)

        is_numeric = all(isinstance(v, (int, float)) for v in values if v is not None)
        
        if is_numeric:
            numeric_values = [v if v is not None else 0 for v in values]
            return labels, numeric_values, "continuous"
        
        unique_labels = sorted(set(labels))
        color_map = self._generate_color_palette(len(unique_labels))
        colors = [color_map[unique_labels.index(label)] for label in labels]
        return labels, colors, "categorical"

    def _generate_color_palette(self, n):
        """Generate a color palette with n colors."""
        base_colors = [
            '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
            '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
        ]
        
        if n <= len(base_colors):
            return base_colors[:n]
        
        colors = []
        for i in range(n):
            hue = i / n
            rgb = colorsys.hsv_to_rgb(hue, 0.7, 0.9)
            colors.append(f'#{int(rgb[0]*255):02x}{int(rgb[1]*255):02x}{int(rgb[2]*255):02x}')
        return colors


class ApplySelectionFromPlot(foo.Operator):
    """Apply sample selection from 3D plot to FiftyOne view."""

    @property
    def config(self):
        return foo.OperatorConfig(
            name="apply_selection_from_plot",
            label="Apply Selection From Plot",
            description="Update FiftyOne selection from 3D plot selection",
            unlisted=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        inputs.list(
            "sample_ids",
            types.String(),
            label="Sample IDs",
            description="List of selected sample IDs",
        )
        return types.Property(inputs)

    def execute(self, ctx):
        sample_ids = ctx.params.get("sample_ids", [])
        ctx.ops.set_selected_samples(sample_ids)


def register(plugin):
    """Register the plugin operators."""
    plugin.register(LoadVisualizationResults)
    plugin.register(ApplySelectionFromPlot)
