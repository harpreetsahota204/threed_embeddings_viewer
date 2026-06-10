/**
 * Color legends: a draggable/collapsible floating container with bodies
 * for categorical (class rows with counts) and continuous (viridis
 * gradient) color fields.
 */

import React, { useCallback, useRef } from 'react';
import { usePanelStatePartial } from '@fiftyone/spaces';
import { PlotCategory } from './State';
import { VIRIDIS_CSS_GRADIENT } from './colors';

/**
 * Draggable, collapsible container for the legends. Position and
 * collapsed state live in panel state so they survive remounts.
 */
export const FloatingPanel = ({
  stateKey,
  title,
  theme,
  children,
}: {
  stateKey: string;
  title: string;
  theme: any;
  children: React.ReactNode;
}) => {
  const [position, setPosition] = usePanelStatePartial(
    `${stateKey}Position`,
    null,
    true
  );
  const [collapsed, setCollapsed] = usePanelStatePartial(
    `${stateKey}Collapsed`,
    false,
    true
  );
  const elRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    const el = elRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;

    const rect = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      const parent = elRef.current?.offsetParent as HTMLElement | null;
      if (!drag || !parent) return;

      const parentRect = parent.getBoundingClientRect();
      setPosition({
        x: Math.max(0, e.clientX - parentRect.left - drag.dx),
        y: Math.max(0, e.clientY - parentRect.top - drag.dy),
      });
    },
    [setPosition]
  );

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div
      ref={elRef}
      style={{
        position: 'absolute',
        ...(position
          ? { left: position.x, top: position.y }
          : { right: '1rem', top: '50%', transform: 'translateY(-50%)' }),
        zIndex: 30,
        maxHeight: '70%',
        display: 'flex',
        flexDirection: 'column',
        background: theme.neutral.softBg,
        borderRadius: 3,
        fontSize: '11px',
        color: theme.text.secondary,
      }}
    >
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          cursor: 'move',
          userSelect: 'none',
          fontWeight: 600,
          color: theme.text.primary,
        }}
        title="Drag to move"
      >
        <span
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCollapsed(!collapsed)}
          style={{ cursor: 'pointer' }}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </span>
        <span
          style={{
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
      </div>
      {!collapsed && children}
    </div>
  );
};

/**
 * Legend body for categorical color fields: one row per class with
 * swatch, label, and count (a histogram-at-a-glance). Click toggles
 * highlighting of the class; shift-click selects its samples as a grid
 * filter.
 */
export const CategoricalLegend = ({
  categories,
  viewCounts,
  highlighted,
  onToggle,
  onSelect,
}: {
  categories: PlotCategory[];
  // Per-category counts within the current view (null = unfiltered)
  viewCounts: number[] | null;
  highlighted: string[];
  onToggle: (label: string) => void;
  onSelect: (label: string) => void;
}) => {
  const anyHighlight = highlighted.length > 0;

  return (
    <div
      style={{ overflowY: 'auto', paddingBottom: 4 }}
      title="Click to highlight a class; shift-click to filter the grid to it"
    >
      {categories.map((category, index) => {
        const isHighlighted = highlighted.includes(category.label);
        const inView = viewCounts?.[index];
        return (
          <div
            key={category.label}
            onClick={(e) =>
              e.shiftKey ? onSelect(category.label) : onToggle(category.label)
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 8px',
              cursor: 'pointer',
              opacity: anyHighlight && !isHighlighted ? 0.4 : 1,
              fontWeight: isHighlighted ? 600 : 400,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: category.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                maxWidth: 140,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {category.label}
            </span>
            <span
              style={{
                marginLeft: 'auto',
                paddingLeft: 8,
                opacity: inView === 0 ? 0.5 : 1,
              }}
            >
              {viewCounts
                ? `${inView!.toLocaleString()} / ${category.count.toLocaleString()}`
                : category.count.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** Legend body for continuous color fields: vertical viridis gradient */
export const ColorLegend = ({ min, max }: { min: number; max: number }) => (
  <div
    style={{
      display: 'flex',
      gap: 6,
      alignItems: 'stretch',
      padding: '0 8px 6px',
    }}
  >
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        textAlign: 'right',
      }}
    >
      <span>{max.toFixed(3)}</span>
      <span>{min.toFixed(3)}</span>
    </div>
    <div
      style={{
        width: 12,
        height: 160,
        borderRadius: 2,
        background: VIRIDIS_CSS_GRADIENT,
      }}
    />
  </div>
);
