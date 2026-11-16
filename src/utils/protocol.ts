import { ActivityId, ActivityPrediction, ImuSample } from '../types/telemetry';

/**
 * Декодує 8-байтний пакет BleActivityPacket_t з BLE характеристики CHAR_ACTIVITY:
 *   0..3 : uint32 timestamp_ms (HAL_GetTick)
 *   4    : uint8  activity_id (0..4)
 *   5    : uint8  confidence (0..100 %)
 *   6..7 : uint16 missed_samples (imu_missed)
 */
export function decodeActivityPacket(view: DataView): ActivityPrediction | null {
  if (view.byteLength < 8) return null;
  const timestampMs = view.getUint32(0, true);
  const rawAct = view.getUint8(4);
  const activityId = (rawAct <= 4 ? rawAct : 1) as ActivityId;
  const confidence = Math.min(100, view.getUint8(5));
  const missedSamples = view.getUint16(6, true);

  return {
    timestampMs,
    receivedAt: Date.now(),
    activityId,
    confidence,
    missedSamples,
    source: 'ble-mcu',
  };
}

/**
 * Декодує опційний 16-байтний пакет сирих IMU-даних (BLE_SEND_RAW_IMU=1).
 */
export function decodeImuPacket(view: DataView, seq: number): ImuSample | null {
  if (view.byteLength < 16) return null;
  const timestampMs = view.getUint32(0, true);
  const MG_TO_MS2 = 0.00980665;
  const ax = view.getInt16(4, true) * MG_TO_MS2;
  const ay = view.getInt16(6, true) * MG_TO_MS2;
  const az = view.getInt16(8, true) * MG_TO_MS2;
  const gx = view.getInt16(10, true) * 0.1;
  const gy = view.getInt16(12, true) * 0.1;
  const gz = view.getInt16(14, true) * 0.1;
  const magnitudeA = Math.sqrt(ax * ax + ay * ay + az * az);

  return {
    seq,
    timestampMs,
    receivedAt: Date.now(),
    ax,
    ay,
    az,
    gx,
    gy,
    gz,
    magnitudeA,
  };
}

export type SerialParseResult =
  | { kind: 'imu'; sample: ImuSample }
  | { kind: 'activity'; prediction: ActivityPrediction }
  | { kind: 'missed'; count: number }
  | { kind: 'whoami'; idHex: string }
  | { kind: 'ble_diag'; ok: boolean; line: string }
  | { kind: 'info'; line: string };

/**
 * Парсер текстових рядків із USART1 або BLE NUS:
 * - #act,<timestamp_ms>,<activity_id>,<confidence>,<missed_samples>
 * - timestamp_ms,ax,ay,az,gx,gy,gz (поточний main.c CSV)
 * - # missed <N>
 * - WHO_AM_I = 0x6B
 * - [BLE] ...
 */
export function parseTextTelemetryLine(
  rawLine: string,
  seq: number,
  channelSource: 'ble-mcu' | 'usb-mcu' = 'usb-mcu'
): SerialParseResult | null {
  const line = rawLine.trim();
  if (!line) return null;

  if (line.startsWith('[BLE]')) {
    const ok = line.includes('OK') || line.includes('ADV=1') || line.includes('READY');
    return { kind: 'ble_diag', ok, line };
  }

  if (line.startsWith('# missed')) {
    const match = line.match(/# missed\s+(\d+)/);
    if (match) {
      return { kind: 'missed', count: Number(match[1]) };
    }
  }

  if (line.startsWith('#act,')) {
    const parts = line.split(',');
    if (parts.length >= 4) {
      const timestampMs = Number(parts[1]) || Date.now();
      const rawAct = Number(parts[2]);
      const activityId = (rawAct >= 0 && rawAct <= 4 ? rawAct : 1) as ActivityId;
      const confidence = Math.min(100, Math.max(0, Number(parts[3]) || 0));
      const missedSamples = parts[4] !== undefined ? Number(parts[4]) || 0 : 0;
      return {
        kind: 'activity',
        prediction: {
          timestampMs,
          receivedAt: Date.now(),
          activityId,
          confidence,
          missedSamples,
          source: channelSource,
        },
      };
    }
  }

  if (line.startsWith('{') && line.endsWith('}')) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (typeof obj.act === 'number') {
        const activityId = (obj.act >= 0 && obj.act <= 4 ? obj.act : 1) as ActivityId;
        return {
          kind: 'activity',
          prediction: {
            timestampMs: typeof obj.t === 'number' ? obj.t : Date.now(),
            receivedAt: Date.now(),
            activityId,
            confidence: typeof obj.conf === 'number' ? obj.conf : 90,
            missedSamples: typeof obj.missed === 'number' ? obj.missed : 0,
            source: channelSource,
          },
        };
      }
    } catch {
      // fall through
    }
  }

  if (line.includes('WHO_AM_I')) {
    const m = line.match(/0x[0-9A-Fa-f]{2}/);
    if (m) return { kind: 'whoami', idHex: m[0] };
  }

  if (line.startsWith('timestamp_ms') || line.startsWith('Start') || line.startsWith('#')) {
    return { kind: 'info', line };
  }

  const cols = line.split(',');
  if (cols.length >= 7) {
    const timestampMs = Number(cols[0]);
    const ax = Number(cols[1]);
    const ay = Number(cols[2]);
    const az = Number(cols[3]);
    const gx = Number(cols[4]);
    const gy = Number(cols[5]);
    const gz = Number(cols[6]);
    if (
      Number.isFinite(timestampMs) &&
      Number.isFinite(ax) &&
      Number.isFinite(ay) &&
      Number.isFinite(az) &&
      Number.isFinite(gx) &&
      Number.isFinite(gy) &&
      Number.isFinite(gz)
    ) {
      return {
        kind: 'imu',
        sample: {
          seq,
          timestampMs,
          receivedAt: Date.now(),
          ax,
          ay,
          az,
          gx,
          gy,
          gz,
          magnitudeA: Math.sqrt(ax * ax + ay * ay + az * az),
        },
      };
    }
  }

  return { kind: 'info', line };
}

/**
 * Допоміжна оцінка активності з сирого USB-потоку IMU, поки в main.c ще не додано X-CUBE-AI.
 */
export function estimateActivityFromWindow(samples: ImuSample[]): {
  activityId: ActivityId;
  confidence: number;
} {
  if (samples.length < 8) {
    return { activityId: 1, confidence: 72 };
  }
  const win = samples.slice(-27);
  const mags = win.map((s) => s.magnitudeA);
  const meanA = mags.reduce((a, b) => a + b, 0) / mags.length;
  const varA = mags.reduce((acc, v) => acc + (v - meanA) ** 2, 0) / mags.length;
  const stdA = Math.sqrt(varA);

  const gyroMag =
    win.reduce((acc, s) => acc + Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz), 0) /
    win.length;

  if (stdA < 0.14 && gyroMag < 2.5) {
    return { activityId: 0, confidence: 88 }; // Lying
  }
  if (stdA < 0.65 && gyroMag < 14) {
    return { activityId: 1, confidence: 85 }; // Stationary
  }
  if (stdA > 4.2 || Math.max(...mags) > 18.5) {
    return { activityId: 3, confidence: 91 }; // Running
  }
  if (gyroMag > 65 && stdA > 1.8) {
    return { activityId: 4, confidence: 78 }; // Stairs
  }
  return {
    activityId: 2, // Walking
    confidence: Math.min(94, Math.round(74 + stdA * 6)),
  };
}

export function exportPredictionsToCsv(
  predictions: ActivityPrediction[],
  filename = 'u585_activity_log.csv'
): void {
  const header = 'timestamp_ms,activity_id,confidence_pct,missed_samples,source\n';
  const rows = predictions
    .map((p) => `${p.timestampMs},${p.activityId},${p.confidence},${p.missedSamples},${p.source}`)
    .join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportSamplesToCsv(samples: ImuSample[], filename = 'stm32u585_imu_log.csv'): void {
  const header = 'seq,timestamp_ms,ax_ms2,ay_ms2,az_ms2,gx_dps,gy_dps,gz_dps,mag_ms2\n';
  const rows = samples
    .map(
      (s) =>
        `${s.seq},${s.timestampMs},${s.ax.toFixed(3)},${s.ay.toFixed(3)},${s.az.toFixed(3)},${s.gx.toFixed(3)},${s.gy.toFixed(3)},${s.gz.toFixed(3)},${s.magnitudeA.toFixed(3)}`
    )
    .join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
