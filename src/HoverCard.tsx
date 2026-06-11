/**
 * Floating card next to the hovered point: thumbnail + value lines.
 * Flips above/left when near the viewport edge so it stays on screen.
 */

import { useLayoutEffect, useRef, useState } from 'react';

const CARD_WIDTH = 122;
const MARGIN = 16;
const VIEWPORT_PAD = 8;

function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x + MARGIN;
  let top = y + MARGIN;

  if (left + width > vw - VIEWPORT_PAD) {
    left = x - width - MARGIN;
  }
  if (top + height > vh - VIEWPORT_PAD) {
    top = y - height - MARGIN;
  }

  return {
    left: Math.max(VIEWPORT_PAD, Math.min(left, vw - width - VIEWPORT_PAD)),
    top: Math.max(VIEWPORT_PAD, Math.min(top, vh - height - VIEWPORT_PAD)),
  };
}

const HoverCard = ({
  x,
  y,
  src,
  lines,
  theme,
}: {
  x: number;
  y: number;
  src: string | null;
  lines: string[];
  theme: any;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // Positioned before paint by the layout effect below, which measures the
  // real card size; this initial offset is only a pre-measurement default.
  const [pos, setPos] = useState({ left: x + MARGIN, top: y + MARGIN });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos(clampPosition(x, y, width, height));
  }, [x, y, src, lines]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: CARD_WIDTH,
        borderRadius: 4,
        border: `1px solid ${theme.primary.plainBorder}`,
        background: theme.background.level2,
        overflow: 'hidden',
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      {src && (
        <img
          key={src}
          src={src}
          style={{
            width: 120,
            height: 120,
            objectFit: 'cover',
            display: 'block',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div style={{ padding: '4px 6px', fontSize: '11px' }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color: theme.text.primary,
              wordBreak: 'break-all',
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

export default HoverCard;
