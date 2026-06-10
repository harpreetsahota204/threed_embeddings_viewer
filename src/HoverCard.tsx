/**
 * Floating card next to the hovered point: thumbnail + value lines.
 */

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
}) => (
  <div
    style={{
      position: 'fixed',
      left: x + 16,
      top: y + 16,
      width: 122,
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
        style={{ width: 120, height: 120, objectFit: 'cover', display: 'block' }}
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
            // Wrap rather than truncate so full sample ids stay readable
            wordBreak: 'break-all',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  </div>
);

export default HoverCard;
