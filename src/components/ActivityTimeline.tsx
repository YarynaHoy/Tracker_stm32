import React, { useMemo } from 'react';
import { ACTIVITY_CLASSES, ActivityId, ActivityPrediction } from '../types/telemetry';

interface ActivityTimelineProps {
  history: ActivityPrediction[];
  sampleCount: number;
  missedSamples: number;
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  history,
  sampleCount,
  missedSamples,
}) => {
  const distribution = useMemo(() => {
    const counts: Record<ActivityId, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const item of history) {
      counts[item.activityId] = (counts[item.activityId] || 0) + 1;
    }
    const total = Math.max(1, history.length);
    return (Object.keys(ACTIVITY_CLASSES) as unknown as ActivityId[]).map((id) => ({
      meta: ACTIVITY_CLASSES[id],
      count: counts[id],
      pct: Math.round((counts[id] / total) * 100),
    }));
  }, [history]);

  const avgConfidence = useMemo(() => {
    if (history.length === 0) return 0;
    const sum = history.reduce((acc, item) => acc + item.confidence, 0);
    return Math.round(sum / history.length);
  }, [history]);

  const dominantActivity = useMemo(() => {
    if (history.length === 0) return null;
    const sorted = [...distribution].sort((a, b) => b.count - a.count);
    return sorted[0]?.count > 0 ? sorted[0].meta : null;
  }, [distribution, history.length]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Розподіл класів фізичної активності (сесія)
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {history.length} класифікацій
          </span>
        </div>

        <div className="mt-4 space-y-3.5">
          {distribution.map(({ meta, count, pct }) => (
            <div key={meta.id}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-800">
                  {meta.id}. {meta.label}
                </span>
                <span className="font-mono tabular-nums text-slate-600">
                  {history.length === 0 ? 0 : pct}% ({count})
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-sm overflow-hidden">
                <div
                  className="h-full transition-all duration-200"
                  style={{
                    width: `${history.length === 0 ? 0 : pct}%`,
                    backgroundColor: meta.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100">
          <div className="text-xs font-medium text-slate-700 mb-2">
            Стрічка останніх 48 класифікацій
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-slate-400">
              Поки що немає подій класифікації у поточній сесії.
            </p>
          ) : (
            <div className="flex items-center gap-0.5 h-6">
              {history.slice(-48).map((ev, idx) => {
                const meta = ACTIVITY_CLASSES[ev.activityId];
                return (
                  <div
                    key={`${ev.timestampMs}-${idx}`}
                    title={`${meta.label} · ${ev.confidence}%`}
                    className="flex-1 h-full rounded-[1px]"
                    style={{ backgroundColor: meta.color }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">
            Зведення сесії
          </h2>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between items-baseline">
              <dt className="text-slate-500">Переважаюча активність</dt>
              <dd className="font-semibold text-slate-900">
                {dominantActivity ? dominantActivity.label : '—'}
              </dd>
            </div>
            <div className="flex justify-between items-baseline">
              <dt className="text-slate-500">Середня впевненість</dt>
              <dd className="font-mono tabular-nums text-slate-900">
                {history.length > 0 ? `${avgConfidence}%` : '—'}
              </dd>
            </div>
            <div className="flex justify-between items-baseline">
              <dt className="text-slate-500">Отримано класифікацій</dt>
              <dd className="font-mono tabular-nums text-slate-900">{history.length}</dd>
            </div>
            <div className="flex justify-between items-baseline">
              <dt className="text-slate-500">Сирих семплів IMU (USB)</dt>
              <dd className="font-mono tabular-nums text-slate-900">{sampleCount}</dd>
            </div>
            <div className="flex justify-between items-baseline">
              <dt className="text-slate-500">Пропущено переривань (EXTI11)</dt>
              <dd className="font-mono tabular-nums text-slate-900">{missedSamples}</dd>
            </div>
          </dl>
        </div>

        <p className="text-xs text-slate-500 pt-4 border-t border-slate-100 mt-4">
          Контракт моделі: <span className="font-mono">st_ign_realworld_imu_27hz</span> (5 класів, 27.45 Гц, вікно 55 / крок 27).
        </p>
      </div>
    </div>
  );
};
