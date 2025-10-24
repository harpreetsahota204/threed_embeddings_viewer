/**
 * 3D Embeddings Viewer Plugin Entry Point
 */

import { registerComponent, PluginComponentTypes } from '@fiftyone/plugins';
import ThreeDEmbeddingsPanel from './Panel';

// Register the panel component
registerComponent({
  name: 'ThreeDEmbeddingsPanel',
  label: '3D Embeddings Viewer',
  component: ThreeDEmbeddingsPanel,
  type: PluginComponentTypes.Panel,
  activator: ({ dataset }) => dataset !== null,
});
