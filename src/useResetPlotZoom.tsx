import { useState } from "react";

export function useResetPlotZoom() {
  const [zoomRev, setZoomRev] = useState(0);

  const resetZoom = () => {
    setZoomRev((prev) => prev + 1);
  };

  return resetZoom;
}

export function useZoomRevision() {
  const [zoomRev, setZoomRev] = useState(0);
  return [zoomRev, setZoomRev] as const;
}

