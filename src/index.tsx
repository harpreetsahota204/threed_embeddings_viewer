/**
 * 3D Embeddings Viewer Plugin Entry Point
 * Following FiftyOne JS plugin patterns from:
 * https://docs.voxel51.com/plugins/developing_plugins.html#developing-js-plugins
 */

import { registerComponent, PluginComponentTypes } from '@fiftyone/plugins';
import ThreeDEmbeddingsPanel from './Panel';

// Import operators to ensure they are registered
import './Operator';

// Register the panel component
registerComponent({
  name: 'ThreeDEmbeddingsPanel',
  label: '3D Embeddings Viewer',
  component: ThreeDEmbeddingsPanel,
  type: PluginComponentTypes.Panel,
  activator: ({ dataset }) => dataset !== null,
});
