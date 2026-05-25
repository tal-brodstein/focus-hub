interface Props {
  value: number
  max: number
  label: string
  unit: string
  color: string       // hex color for the fill arc
  trackColor?: string
  size?: 'sm' | 'md' | 'lg'
  showTick?: boolean
}

const SIZES = {
  sm: { vb: 100, cx: 50, cy: 50, r: 38, sw: 7,  valSize: 18, unitSize: 9,  lblSize: 8 },
  md: { vb: 120, cx: 60, cy: 60, r: 48, sw: 8,  valSize: 22, unitSize: 10, lblSize: 9 },
  lg: { vb: 200, cx: 100, cy: 100, r: 80, sw: 14, valSize: 40, unitSize: 14, lblSize: 12 },
}

export default function CircularGauge({
  value,
  max,
  label,
  unit,
  color,
  trackColor = '#1e1e3a',
  size = 'md',
  showTick = true,
}: Props) {
  const s = SIZES[size]
  const circ = 2 * Math.PI * s.r

  // 270° arc: starts bottom-left, ends bottom-right
  const arcLen = circ * 0.75
  const gapLen = circ * 0.25

  const pct = Math.min(1, Math.max(0, value / max))
  const filled = arcLen * pct

  return (
    <svg
      viewBox={`0 0 ${s.vb} ${s.vb}`}
      className="w-full h-full"
      aria-label={`${label}: ${value}${unit}`}
    >
      {/* Background track */}
      <circle
        cx={s.cx}
        cy={s.cy}
        r={s.r}
        fill="none"
        stroke={trackColor}
        strokeWidth={s.sw}
        strokeDasharray={`${arcLen} ${gapLen}`}
        strokeLinecap="round"
        transform={`rotate(135 ${s.cx} ${s.cy})`}
      />

      {/* Value fill */}
      <circle
        cx={s.cx}
        cy={s.cy}
        r={s.r}
        fill="none"
        stroke={color}
        strokeWidth={s.sw}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(135 ${s.cx} ${s.cy})`}
        className="gauge-fill"
        style={{ filter: `drop-shadow(0 0 6px ${color}60)` }}
      />

      {/* Center value */}
      <text
        x={s.cx}
        y={s.cy - (size === 'lg' ? 8 : 5)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize={s.valSize}
        fontWeight="700"
        fontFamily="'JetBrains Mono', monospace"
      >
        {Number.isFinite(value) ? Math.round(value) : '--'}
      </text>

      {/* Unit */}
      <text
        x={s.cx}
        y={s.cy + (size === 'lg' ? 20 : 12)}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize={s.unitSize}
      >
        {unit}
      </text>

      {/* Label */}
      {showTick && (
        <text
          x={s.cx}
          y={s.cy + (size === 'lg' ? 40 : 26)}
          textAnchor="middle"
          fill="#64748b"
          fontSize={s.lblSize}
          letterSpacing="0.05em"
        >
          {label.toUpperCase()}
        </text>
      )}
    </svg>
  )
}
