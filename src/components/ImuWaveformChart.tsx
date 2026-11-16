import React, { useMemo, useState } from 'react';
import { ImuSample } from '../types/telemetry';

interface ImuWaveformChartProps {
  samples: ImuSample[];
  windowSize?: number;
}

export const ImuWaveformChart: React.FC<ImuWaveformChartProps> = ({
  samples,
  windowSize = 130,
}) => {
  const [showAccel, setShowAccel] = useState(true);
  const [showGyro, setShowGyro] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visible = useMemo(() => samples.slice(-windowSize), [samples, windowSize]);

  const width = 820;
  const accelH = 190;
  const gyroH = 150;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 18;

  const plotW = width - padL - padR;

  const accelScale = useMemo(() => {
    let maxAbs = 16;
    for (const s of visible) {
      maxAbs = Math.max(maxAbs, Math.abs(s.ax), Math.abs(s.ay), Math.abs(s.az));
    }
    return Math.ceil(maxAbs / 5) * 5;
  }, [visible]);

  const gyroScale = useMemo(() => {
    let maxAbs = 120;
    for (const s of visible) {
      maxAbs = Math.max(maxAbs, Math.abs(s.gx), Math.abs(s.gy), Math.abs(s.gz));
    }
    return Math.ceil(maxAbs / 50) * 50;
  }, [visible]);

  const buildPath = (
    getter: (s: ImuSample) => number,
    maxAbs: number,
    height: number
  ): string => {
    if (visible.length === 0) return '';
    const innerH = height - padT - padB;
    return visible
      .map((s, idx) => {
        const x =
          visible.length === 1
            ? padL
            : padL + (idx / (windowSize - 1)) * plotW;
        const clamped = Math.max(-maxAbs, Math.min(maxAbs, getter(s)));
        const norm = (maxAbs - clamped) / (2 * maxAbs);
        const y = padT + norm * innerH;
        return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (visible.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.round(((relX - padL) / plotW) * (windowSize - 1));
    if (idx >= 0 && idx < visible.length) {
      setHoverIdx(idx);
    } else {
      setHoverIdx(null);
    }
  };

  const hovered = hoverIdx !== null && visible[hoverIdx] ? visible[hoverIdx] : null;
  const latest = visible[visible.length - 1] ?? null;
  const readout = hovered ?? latest;

  const hoverX =
    hoverIdx !== null && visible.length > 0
      ? padL + (hoverIdx / (windowSize - 1)) * plotW
      : null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      {/* Chart Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Шестиосьовий сигнал ISM330DHCX у реальному часі
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Вікно останніх {windowSize} відліків ({(windowSize / 26).toFixed(1)} с при 26 Гц)
            {readout ? (
              <span className="font-mono tabular-nums text-slate-700 ml-2">
                · t = {readout.timestampMs} мс · |a| = {readout.magnitudeA.toFixed(2)} м/с²
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAccel((v) => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              showAccel
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            Акселерометр (м/с²)
          </button>
          <button
            type="button"
            onClick={() => setShowGyro((v) => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              showGyro
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            Гіроскоп (°/с)
          </button>
        </div>
      </div>

      {/* Empty state if no samples */}
      {visible.length === 0 ? (
        <div className="h-[260px] flex flex-col items-center justify-center px-6 text-center bg-slate-50/50">
          <p className="text-sm font-medium text-slate-700">
            Сигнал 6 осей IMU (відображається при USB-потоці або BLE_SEND_RAW_IMU=1)
          </p>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md">
            У режимі передачі лише підсумку класифікації по BLE активність оновлюється у картці та журналі без навантаження на радіоканал.
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {showAccel && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5 px-1">
                <span className="text-xs font-medium text-slate-600">
                  Прискорення (±4g)
                </span>
                <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                  <span className="text-blue-600">
                    ax: {readout ? readout.ax.toFixed(2) : '0.00'}
                  </span>
                  <span className="text-cyan-600">
                    ay: {readout ? readout.ay.toFixed(2) : '0.00'}
                  </span>
                  <span className="text-amber-600">
                    az: {readout ? readout.az.toFixed(2) : '0.00'}
                  </span>
                  <span className="text-slate-400">м/с²</span>
                </div>
              </div>

              <svg
                viewBox={`0 0 ${width} ${accelH}`}
                className="w-full h-44 bg-slate-50/70 border border-slate-200 rounded cursor-crosshair select-none"
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoverIdx(null)}
              >
                {[-accelScale, -accelScale / 2, 0, accelScale / 2, accelScale].map((tick) => {
                  const y =
                    padT +
                    ((accelScale - tick) / (2 * accelScale)) * (accelH - padT - padB);
                  return (
                    <g key={tick}>
                      <line
                        x1={padL}
                        x2={width - padR}
                        y1={y}
                        y2={y}
                        stroke={tick === 0 ? '#CBD5E1' : '#E2E8F0'}
                        strokeDasharray={tick === 0 ? undefined : '3 3'}
                        strokeWidth={1}
                      />
                      <text
                        x={padL - 6}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-slate-400 text-[10px] font-mono"
                      >
                        {tick.toFixed(0)}
                      </text>
                    </g>
                  );
                })}

                <path
                  d={buildPath((s) => s.ax, accelScale, accelH)}
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth={1.6}
                />
                <path
                  d={buildPath((s) => s.ay, accelScale, accelH)}
                  fill="none"
                  stroke="#0891B2"
                  strokeWidth={1.6}
                />
                <path
                  d={buildPath((s) => s.az, accelScale, accelH)}
                  fill="none"
                  stroke="#D97706"
                  strokeWidth={1.6}
                />

                {hoverX !== null && (
                  <line
                    x1={hoverX}
                    x2={hoverX}
                    y1={padT}
                    y2={accelH - padB}
                    stroke="#0F172A"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                )}
              </svg>
            </div>
          )}

          {showGyro && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5 px-1">
                <span className="text-xs font-medium text-slate-600">
                  Кутова швидкість (±2000 °/с)
                </span>
                <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                  <span className="text-indigo-600">
                    gx: {readout ? readout.gx.toFixed(1) : '0.0'}
                  </span>
                  <span className="text-teal-600">
                    gy: {readout ? readout.gy.toFixed(1) : '0.0'}
                  </span>
                  <span className="text-rose-600">
                    gz: {readout ? readout.gz.toFixed(1) : '0.0'}
                  </span>
                  <span className="text-slate-400">°/с</span>
                </div>
              </div>

              <svg
                viewBox={`0 0 ${width} ${gyroH}`}
                className="w-full h-36 bg-slate-50/70 border border-slate-200 rounded cursor-crosshair select-none"
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoverIdx(null)}
              >
                {[-gyroScale, 0, gyroScale].map((tick) => {
                  const y =
                    padT +
                    ((gyroScale - tick) / (2 * gyroScale)) * (gyroH - padT - padB);
                  return (
                    <g key={tick}>
                      <line
                        x1={padL}
                        x2={width - padR}
                        y1={y}
                        y2={y}
                        stroke={tick === 0 ? '#CBD5E1' : '#E2E8F0'}
                        strokeDasharray={tick === 0 ? undefined : '3 3'}
                        strokeWidth={1}
                      />
                      <text
                        x={padL - 6}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-slate-400 text-[10px] font-mono"
                      >
                        {tick.toFixed(0)}
                      </text>
                    </g>
                  );
                })}

                <path
                  d={buildPath((s) => s.gx, gyroScale, gyroH)}
                  fill="none"
                  stroke="#4F46E5"
                  strokeWidth={1.5}
                />
                <path
                  d={buildPath((s) => s.gy, gyroScale, gyroH)}
                  fill="none"
                  stroke="#0D9488"
                  strokeWidth={1.5}
                />
                <path
                  d={buildPath((s) => s.gz, gyroScale, gyroH)}
                  fill="none"
                  stroke="#E11D48"
                  strokeWidth={1.5}
                />

                {hoverX !== null && (
                  <line
                    x1={hoverX}
                    x2={hoverX}
                    y1={padT}
                    y2={gyroH - padB}
                    stroke="#0F172A"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                )}
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
