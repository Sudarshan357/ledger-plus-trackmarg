import { formatRupees } from '../lib/format';

// A hand-drawn SVG bar chart rather than a charting library. The reference chart is five bars
// and a value axis; pulling in a chart package would add more to the bundle than the entire
// rest of this app, on a screen a partner opens over a mobile connection.

interface Props {
  data: Array<{ category: string; amount: number }>;
}

/// Picks the unit the axis is labelled in. The reference reads values in lakh, which is right
/// for a month of real turnover but turns a Rs 2,000 month into "0.020" - so the unit follows
/// the data instead of being fixed, and the caption always says which one is in use.
function pickUnit(max: number): { divisor: number; caption: string; decimals: number } {
  if (max >= 100000) return { divisor: 100000, caption: 'Values in ₹ Lakh', decimals: 2 };
  if (max >= 1000) return { divisor: 1000, caption: 'Values in ₹ Thousand', decimals: 1 };
  return { divisor: 1, caption: 'Values in ₹', decimals: 0 };
}

const HEIGHT = 190;
const PAD_TOP = 12;
const PAD_BOTTOM = 30;
const PAD_LEFT = 46;
const TICKS = 4;

export function CategoryChart({ data }: Props) {
  // Only categories with spending, matching the reference - five labelled ticks on a phone
  // would collide, and an empty category tells the reader nothing.
  const bars = data.filter((entry) => entry.amount > 0);

  if (bars.length === 0) {
    return <p className="chart-caption">No expenses recorded for this period.</p>;
  }

  const dataMax = Math.max(...bars.map((b) => b.amount));
  // Headroom so the tallest bar never touches the top gridline.
  const axisMax = dataMax * 1.1;
  const { divisor, caption, decimals } = pickUnit(axisMax);

  // Bars get a fixed slot width so a five-category month scrolls sideways rather than
  // squeezing the labels into each other.
  const slot = Math.max(64, Math.min(110, Math.round(300 / bars.length)));
  const width = PAD_LEFT + slot * bars.length + 12;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => (axisMax / TICKS) * i);

  return (
    <>
      <p className="chart-caption">{caption}</p>
      <div className="chart-wrap">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`Expenses by category. ${bars
            .map((b) => `${b.category} ${formatRupees(b.amount)}`)
            .join(', ')}.`}
        >
          {ticks.map((value, i) => {
            const y = PAD_TOP + plotHeight - (plotHeight / TICKS) * i;
            return (
              <g key={i}>
                {/* Styled by class rather than a literal fill so the chart follows the
                    theme like everything else - an SVG with baked-in greys is the usual way a
                    dark mode ends up with one stubbornly light component. */}
                <line
                  className={i === 0 ? 'chart-axis' : 'chart-grid'}
                  x1={PAD_LEFT}
                  x2={width - 6}
                  y1={y}
                  y2={y}
                  strokeWidth={1}
                />
                <text className="chart-tick" x={PAD_LEFT - 8} y={y + 4} textAnchor="end" fontSize={11}>
                  {(value / divisor).toFixed(decimals + 1)}
                </text>
              </g>
            );
          })}

          {bars.map((bar, i) => {
            const barWidth = Math.min(46, slot * 0.52);
            const x = PAD_LEFT + slot * i + (slot - barWidth) / 2;
            const height = axisMax === 0 ? 0 : (bar.amount / axisMax) * plotHeight;
            return (
              <g key={bar.category}>
                <rect
                  x={x}
                  // A bar of literally zero height would disappear; a 2px stub still reads as
                  // "present but tiny", which is what the reference shows for its Rs 50 entry.
                  y={PAD_TOP + plotHeight - Math.max(height, 2)}
                  width={barWidth}
                  height={Math.max(height, 2)}
                  rx={2}
                  className="chart-bar"
                />
                <text
                  className="chart-label"
                  x={x + barWidth / 2}
                  y={HEIGHT - 10}
                  textAnchor="middle"
                  fontSize={12}
                >
                  {bar.category}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}
