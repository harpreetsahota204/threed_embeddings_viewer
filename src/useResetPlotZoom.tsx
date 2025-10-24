import { useState } from "react";

export function useResetPlotZoom() {
  const [, setCameraReset] = useState(0);

  const resetZoom = () => {
    // Force camera reset by incrementing counter
    // This will be used to recreate the camera object
    setCameraReset((prev) => prev + 1);
  };

  return resetZoom;
}

export function useZoomRevision() {
  const [zoomRev, setZoomRev] = useState(0);
  return [zoomRev, setZoomRev] as const;
}

export function useCameraReset() {
  const [cameraReset, setCameraReset] = useState(0);
  
  const resetCamera = () => {
    setCameraReset((prev) => prev + 1);
  };
  
  return [cameraReset, resetCamera] as const;
}

