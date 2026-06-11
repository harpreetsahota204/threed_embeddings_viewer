/**
 * OrbitController with cursor-dolly scroll zoom for 3D point clouds.
 *
 * deck's default zoom magnifies around the target's depth plane without
 * advancing the camera. This subclass also moves the target toward the
 * 3D point under the cursor (from dollyAnchor.ts) so you can fly into a
 * dense region. Zoom-out stays a pure scale.
 */

import { OrbitController } from '@deck.gl/core';
import { getDollyAnchor } from './dollyAnchor';
import {
  dollyTargetTowardAnchor,
  viewDirection,
  wheelZoomScale,
} from './dollyMath';

const NO_TRANSITION = { transitionDuration: 0 } as const;

export class CursorDollyOrbitController extends OrbitController {
  protected _onWheel(event: any): boolean {
    if (!this.scrollZoom) return false;

    const pos = this.getCenter(event);
    if (!this.isPointInBounds(pos, event)) return false;
    event.srcEvent.preventDefault();

    const speed =
      this.scrollZoom === true
        ? 0.01
        : (this.scrollZoom as { speed?: number }).speed ?? 0.01;
    const scale = wheelZoomScale(event.delta, speed);

    let state: any = this.controllerState.zoom({ pos, scale });

    const anchor = getDollyAnchor();
    if (anchor && scale > 1) {
      const props = state.getViewportProps();
      const target = props.target as [number, number, number];
      const cam = (this.makeViewport(props) as any).cameraPosition as [
        number,
        number,
        number,
      ];
      state = state._getUpdatedState({
        target: dollyTargetTowardAnchor(
          target,
          anchor,
          viewDirection(target, cam),
          scale
        ),
      });
    }

    this.updateViewport(state, NO_TRANSITION, {
      isZooming: false,
      isPanning: false,
    });
    return true;
  }
}
