// Two chart shapes, no dependencies.
//
// The site is static, so charts are built as SVG strings from the derived JSON.
// Both helpers return markup rather than touching the DOM, which keeps the page
// scripts readable and the output inspectable.
//
// Series may contain nulls: a lap with no position, or a rider who had not yet
// raced. A null breaks the line rather than interpolating across it, because an
// invented point between two real ones is a claim the data does not make.

export const PALETTE = [
  '#4cc2ff', // sky
  '#f0679e', // accent rose
  '#86d9a5', // mint
  '#b39dfb', // violet
  '#dbe7f3', // ice
  '#2dd4bf', // teal
  '#8fa3b8', // slate
];

/**
 * Colour for series `index` of `count`. Small charts use the fixed palette; a
 * lap chart with twenty riders rotates hue and lightness instead, skipping the
 * warm band so nothing reads as the retired amber.
 */
export function seriesColour(index, count = PALETTE.length) {
  if (count <= PALETTE.length) return PALETTE[index % PALETTE.length];
  let hue = (190 + index * 137.508) % 360;
  if (hue > 20 && hue < 68) hue = (hue + 120) % 360;
  return `hsl(${hue.toFixed(0)} 70% ${index % 2 ? 74 : 58}%)`;
}

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/**
 * Line chart. `series` is `[{ label, points: number[] }]`, one point per x label.
 * `invertY` puts the smallest value at the top, which is what a position chart
 * needs (1st above 2nd).
 */
export function lineChart({
  series,
  xLabels,
  width = 900,
  height = 420,
  yMin,
  yMax,
  yStep,
  invertY = false,
  yLabel = '',
  showLegend = true,
  tickEvery = 1,
}) {
  const pad = { top: 16, right: showLegend ? 150 : 20, bottom: 40, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const flat = series.flatMap((line) => line.points).filter((value) => Number.isFinite(value));
  const min = yMin ?? Math.min(...flat);
  const max = yMax ?? Math.max(...flat);
  const step = yStep ?? Math.max(1, Math.ceil((max - min) / 8));

  const xAt = (index) =>
    pad.left + (xLabels.length <= 1 ? plotW / 2 : (index / (xLabels.length - 1)) * plotW);
  const yAt = (value) => {
    const share = max === min ? 0.5 : (value - min) / (max - min);
    return invertY ? pad.top + share * plotH : pad.top + plotH - share * plotH;
  };

  const parts = [];
  parts.push(
    `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(yLabel || 'chart')}" preserveAspectRatio="xMidYMid meet">`,
  );

  // Horizontal gridlines and y labels, inclusive of the maximum.
  const ticks = [];
  for (let value = min; value <= max + 1e-9; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] < max) ticks.push(max);
  for (const value of ticks) {
    const y = yAt(value);
    parts.push(`<line class="grid" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${Number.isInteger(value) ? value : value.toFixed(1)}</text>`);
  }

  parts.push(`<line class="axis" x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}"/>`);
  parts.push(`<line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}"/>`);

  xLabels.forEach((label, index) => {
    if (index % tickEvery !== 0 && index !== xLabels.length - 1) return;
    parts.push(
      `<text x="${xAt(index).toFixed(1)}" y="${pad.top + plotH + 18}" text-anchor="middle">${esc(label)}</text>`,
    );
  });

  series.forEach((line, seriesIndex) => {
    const colour = seriesColour(seriesIndex, series.length);
    let path = '';
    let pen = false;
    line.points.forEach((value, index) => {
      if (!Number.isFinite(value)) {
        pen = false;
        return;
      }
      const command = pen ? 'L' : 'M';
      path += `${command}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)} `;
      pen = true;
    });
    if (path) {
      parts.push(
        `<path d="${path.trim()}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
    // Markers only when the series is short enough to read them.
    if (line.points.length <= 24) {
      line.points.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        parts.push(`<circle cx="${xAt(index).toFixed(1)}" cy="${yAt(value).toFixed(1)}" r="2.4" fill="${colour}"/>`);
      });
    }
  });

  if (showLegend) {
    series.forEach((line, index) => {
      const y = pad.top + 8 + index * 18;
      parts.push(`<rect x="${width - pad.right + 8}" y="${y - 8}" width="10" height="10" rx="2" fill="${seriesColour(index, series.length)}"/>`);
      parts.push(`<text x="${width - pad.right + 24}" y="${y + 1}">${esc(line.label)}</text>`);
    });
  }

  parts.push('</svg>');
  return parts.join('');
}

/**
 * Horizontal bars: one bar per row, label on the left, value at the right.
 * Values may be negative, in which case the zero line sits inside the plot.
 */
export function hBars({ rows, width = 900, rowHeight = 24, labelWidth = 300, format = (value) => String(value), zeroAt = null, ariaLabel = '' }) {
  const pad = { top: 8, right: 76, bottom: 8, left: labelWidth };
  const plotW = width - pad.left - pad.right;
  const height = pad.top + pad.bottom + rows.length * rowHeight;
  const values = rows.map((row) => row.value).filter((value) => Number.isFinite(value));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const xAt = (value) => pad.left + ((value - min) / span) * plotW;
  const zero = zeroAt === null ? xAt(0) : xAt(zeroAt);

  const parts = [
    `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel || 'bars')}" preserveAspectRatio="xMidYMid meet">`,
  ];
  if (min < 0) {
    parts.push(`<line class="axis" x1="${zero.toFixed(1)}" y1="${pad.top}" x2="${zero.toFixed(1)}" y2="${height - pad.bottom}"/>`);
  }
  rows.forEach((row, index) => {
    const y = pad.top + index * rowHeight;
    const value = Number.isFinite(row.value) ? row.value : 0;
    const start = Math.min(zero, xAt(value));
    const barWidth = Math.abs(xAt(value) - zero);
    const colour = row.color ?? (value < 0 ? '#4ade80' : PALETTE[0]);
    parts.push(`<text x="${pad.left - 10}" y="${(y + rowHeight / 2 + 4).toFixed(1)}" text-anchor="end">${esc(row.label)}</text>`);
    parts.push(
      `<rect x="${start.toFixed(1)}" y="${(y + 4).toFixed(1)}" width="${Math.max(1, barWidth).toFixed(1)}" height="${rowHeight - 10}" rx="2" fill="${colour}" opacity="0.85"/>`,
    );
    const labelX = value < 0 ? xAt(value) - 6 : xAt(value) + 6;
    parts.push(
      `<text x="${labelX.toFixed(1)}" y="${(y + rowHeight / 2 + 4).toFixed(1)}" text-anchor="${value < 0 ? 'end' : 'start'}">${esc(format(value))}</text>`,
    );
  });
  parts.push('</svg>');
  return parts.join('');
}
