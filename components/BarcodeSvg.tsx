import { ean13Modules, isValidEan13 } from '@/lib/barcode';

// Renders a real, scannable EAN-13 — guard bars (start/middle/end) drawn
// taller than the digit bars, same as a real printed barcode, so a
// scanner (including our own) reads it back correctly and it looks like
// an actual label, not a generic striped rectangle.
export default function BarcodeSvg({ code, width = 220, height = 80 }: { code: string; width?: number; height?: number }) {
  if (!isValidEan13(code)) return null;

  const modules = ean13Modules(code);
  const moduleWidth = width / modules.length;
  const barHeight = height * 0.72;
  const guardHeight = height * 0.82;
  const guardRanges = [[0, 2], [45, 49], [92, 94]];
  const isGuard = (i: number) => guardRanges.some(([a, b]) => i >= a && i <= b);

  const bars: React.ReactNode[] = [];
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] !== '1') continue;
    const h = isGuard(i) ? guardHeight : barHeight;
    bars.push(<rect key={i} x={i * moduleWidth} y={0} width={moduleWidth} height={h} fill="#000" />);
  }

  return (
    <svg viewBox={`0 0 ${width} ${height + 14}`} width={width} height={height + 14} role="img" aria-label={`Barcode ${code}`}>
      <rect x={0} y={0} width={width} height={height + 14} fill="#fff" />
      <g>{bars}</g>
      <text x={width / 2} y={height + 11} textAnchor="middle" fontSize={11} fontFamily="monospace" fill="#000" letterSpacing={1}>
        {code}
      </text>
    </svg>
  );
}
