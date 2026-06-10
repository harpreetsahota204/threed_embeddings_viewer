import React from 'react';

/**
 * Panel tab icon: Material Design's `view_in_ar` (a 3D cube in AR corner
 * brackets), path data verbatim from @mui/icons-material@5.15.20
 * (Apache 2.0). Inlined rather than imported because the App does not
 * expose @mui/icons-material to plugins, and bundling it would pull in
 * MUI runtime internals.
 */
const EmbeddingsPanelIcon = ({ style }: { style?: React.CSSProperties }) => (
  // The App renders panel icons inside a taller box; a raw inline <svg>
  // sits on the text baseline and appears high, so center it vertically
  <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
    <svg viewBox="0 0 24 24" fill="currentColor" style={style}>
      <path d="m18.25 7.6-5.5-3.18c-.46-.27-1.04-.27-1.5 0L5.75 7.6c-.46.27-.75.76-.75 1.3v6.35c0 .54.29 1.03.75 1.3l5.5 3.18c.46.27 1.04.27 1.5 0l5.5-3.18c.46-.27.75-.76.75-1.3V8.9c0-.54-.29-1.03-.75-1.3M7 14.96v-4.62l4 2.32v4.61zm5-4.03L8 8.61l4-2.31 4 2.31zm1 6.34v-4.61l4-2.32v4.62zM7 2H3.5C2.67 2 2 2.67 2 3.5V7h2V4h3zm10 0h3.5c.83 0 1.5.67 1.5 1.5V7h-2V4h-3zM7 22H3.5c-.83 0-1.5-.67-1.5-1.5V17h2v3h3zm10 0h3.5c.83 0 1.5-.67 1.5-1.5V17h-2v3h-3z" />
    </svg>
  </div>
);

export default EmbeddingsPanelIcon;
