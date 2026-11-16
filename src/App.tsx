import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bluetooth,
  Download,
  Pause,
  Play,
  Trash2,
  Usb,
} from 'lucide-react';
import {
  ACTIVITY_CLASSES,
  ActivityId,
  ActivityPrediction,
  BLE_COMMANDS,
  GATT_UUIDS,
  ImuSample,
  TelemetryLogEntry,
  TransportKind,
} from './types/telemetry';
import {
  decodeActivityPacket,
  decodeImuPacket,
  estimateActivityFromWindow,
  exportPredictionsToCsv,
  exportSamplesToCsv,
  parseTextTelemetryLine,
} from './utils/protocol';
import { ImuWaveformChart } from './components/ImuWaveformChart';
import { ActivityTimeline } from './components/ActivityTimeline';

type ActiveView = 'monitor' | 'analytics';

const MAX_SAMPLES = 520;
const MAX_PREDICTIONS = 240;
const MAX_LOGS = 50;

function formatClock(date = new Date()): string {
  return date.toTimeString().slice(0, 8);
}

export default function App() {
  const [view, setView] = useState<ActiveView>('monitor');
  const [transport, setTransport] = useState<TransportKind>('disconnected');
  const [deviceLabel, setDeviceLabel] = useState<string>('Не підключено');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const [samples, setSamples] = useState<ImuSample[]>([]);
  const [predictions, setPredictions] = useState<ActivityPrediction[]>([]);
  const [logs, setLogs] = useState<TelemetryLogEntry[]>([]);

  const [currentActivity, setCurrentActivity] = useState<ActivityPrediction | null>(null);
  const [missedSamples, setMissedSamples] = useState(0);
  const [whoAmI, setWhoAmI] = useState<string>('—');
  const [bleDiag, setBleDiag] = useState<string>('Очікування');
  const [sampleRateHz, setSampleRateHz] = useState<number>(0);

  const seqRef = useRef(0);
  const logIdRef = useRef(0);
  const samplesRef = useRef<ImuSample[]>([]);
  const pausedRef = useRef(false);
  const rateCounterRef = useRef({ count: 0, lastCheck: Date.now() });

  const bleDeviceRef = useRef<BluetoothDeviceMinimal | null>(null);
  const bleCtrlCharRef = useRef<BluetoothRemoteGATTCharacteristicMinimal | null>(null);
  const serialPortRef = useRef<SerialPortMinimal | null>(null);
  const serialReaderCancelRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  const appendLog = useCallback(
    (channel: TelemetryLogEntry['channel'], summary: string, timestampMs = Date.now(), raw?: string) => {
      logIdRef.current += 1;
      const entry: TelemetryLogEntry = {
        id: logIdRef.current,
        timeStr: formatClock(),
        timestampMs,
        channel,
        summary,
        raw,
      };
      setLogs((prev) => [entry, ...prev].slice(0, MAX_LOGS));
    },
    []
  );

  const pushImuSample = useCallback((sample: ImuSample, runFallbackClassifier: boolean) => {
    if (pausedRef.current) return;

    rateCounterRef.current.count += 1;
    const now = Date.now();
    const elapsed = now - rateCounterRef.current.lastCheck;
    if (elapsed >= 1000) {
      setSampleRateHz(Math.round((rateCounterRef.current.count * 1000) / elapsed));
      rateCounterRef.current = { count: 0, lastCheck: now };
    }

    const nextBuf = [...samplesRef.current, sample].slice(-MAX_SAMPLES);
    samplesRef.current = nextBuf;
    setSamples(nextBuf);

    if (runFallbackClassifier && seqRef.current % 27 === 0) {
      const est = estimateActivityFromWindow(nextBuf);
      const pred: ActivityPrediction = {
        timestampMs: sample.timestampMs,
        receivedAt: now,
        activityId: est.activityId,
        confidence: est.confidence,
        missedSamples: 0,
        source: 'usb-preview',
      };
      setCurrentActivity(pred);
      setPredictions((prev) => [...prev, pred].slice(-MAX_PREDICTIONS));
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setStatusError(null);
    if (bleDeviceRef.current?.gatt?.connected) {
      bleDeviceRef.current.gatt.disconnect();
    }
    bleDeviceRef.current = null;
    bleCtrlCharRef.current = null;

    if (serialReaderCancelRef.current) {
      try {
        await serialReaderCancelRef.current();
      } catch {
        // ignore cancel error
      }
      serialReaderCancelRef.current = null;
    }
    if (serialPortRef.current) {
      try {
        await serialPortRef.current.close();
      } catch {
        // ignore close error
      }
      serialPortRef.current = null;
    }

    setTransport('disconnected');
    setDeviceLabel('Не підключено');
    setSampleRateHz(0);
    setIsPaused(false);
  }, []);

  const handleConnectBle = useCallback(async () => {
    setStatusError(null);
    if (!navigator.bluetooth) {
      setStatusError(
        'Web Bluetooth недоступний у цьому браузері або контексті. Відкрийте сайт у Chrome / Edge по HTTPS або localhost.'
      );
      return;
    }

    try {
      await handleDisconnect();
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [GATT_UUIDS.SERVICE] },
          { services: [GATT_UUIDS.NUS_SERVICE] },
          { namePrefix: 'U585' },
        ],
        optionalServices: [GATT_UUIDS.SERVICE, GATT_UUIDS.NUS_SERVICE],
      });

      bleDeviceRef.current = device;
      setDeviceLabel(device.name || 'U585_HAR');

      device.addEventListener('gattserverdisconnected', () => {
        setTransport('disconnected');
        setDeviceLabel('Відключено');
        setSampleRateHz(0);
        appendLog('BLE', 'Плата відключилась');
      });

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('GATT-сервер пристрою недоступний');
      }

      let boundCustom = false;
      try {
        const svc = await server.getPrimaryService(GATT_UUIDS.SERVICE);
        const charAct = await svc.getCharacteristic(GATT_UUIDS.CHAR_ACTIVITY);
        await charAct.startNotifications();
        charAct.addEventListener('characteristicvaluechanged', (ev: Event) => {
          const target = ev.target as BluetoothRemoteGATTCharacteristicMinimal;
          if (!target.value || pausedRef.current) return;
          const pred = decodeActivityPacket(target.value);
          if (pred) {
            setCurrentActivity(pred);
            setMissedSamples(pred.missedSamples);
            setPredictions((prev) => [...prev, pred].slice(-MAX_PREDICTIONS));
            appendLog(
              'BLE',
              `${ACTIVITY_CLASSES[pred.activityId].label} (${pred.confidence}%)`,
              pred.timestampMs
            );
          }
        });

        try {
          const charImu = await svc.getCharacteristic(GATT_UUIDS.CHAR_IMU);
          await charImu.startNotifications();
          charImu.addEventListener('characteristicvaluechanged', (ev: Event) => {
            const target = ev.target as BluetoothRemoteGATTCharacteristicMinimal;
            if (!target.value) return;
            seqRef.current += 1;
            const sample = decodeImuPacket(target.value, seqRef.current);
            if (sample) {
              pushImuSample(sample, false);
            }
          });
        } catch {
          // CHAR_IMU optional
        }

        try {
          bleCtrlCharRef.current = await svc.getCharacteristic(GATT_UUIDS.CHAR_CONTROL);
        } catch {
          bleCtrlCharRef.current = null;
        }
        boundCustom = true;
      } catch {
        // Fallback to Nordic UART Service
      }

      if (!boundCustom) {
        const nus = await server.getPrimaryService(GATT_UUIDS.NUS_SERVICE);
        const nusTx = await nus.getCharacteristic(GATT_UUIDS.NUS_TX);
        await nusTx.startNotifications();
        let lineBuffer = '';
        const decoder = new TextDecoder();
        nusTx.addEventListener('characteristicvaluechanged', (ev: Event) => {
          const target = ev.target as BluetoothRemoteGATTCharacteristicMinimal;
          if (!target.value) return;
          lineBuffer += decoder.decode(target.value, { stream: true });
          const lines = lineBuffer.split(/\r?\n/);
          lineBuffer = lines.pop() ?? '';
          for (const line of lines) {
            seqRef.current += 1;
            const parsed = parseTextTelemetryLine(line, seqRef.current, 'ble-mcu');
            if (!parsed) continue;
            if (parsed.kind === 'imu') {
              pushImuSample(parsed.sample, true);
            } else if (parsed.kind === 'activity') {
              setCurrentActivity(parsed.prediction);
              setMissedSamples(parsed.prediction.missedSamples);
              setPredictions((prev) => [...prev, parsed.prediction].slice(-MAX_PREDICTIONS));
            }
          }
        });
      }

      setTransport('ble');
      setBleDiag('GATT OK');
      appendLog('BLE', `Підключено до ${device.name || 'U585_HAR'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Помилка підключення BLE';
      if (!msg.toLowerCase().includes('cancelled') && !msg.toLowerCase().includes('canceled')) {
        setStatusError(msg);
      }
      setTransport('disconnected');
    }
  }, [appendLog, handleDisconnect, pushImuSample]);

  const handleConnectSerial = useCallback(async () => {
    setStatusError(null);
    if (!navigator.serial) {
      setStatusError(
        'Web Serial недоступний у цьому браузері. Використайте Chrome / Edge для читання USART1 (115200 бод).'
      );
      return;
    }

    try {
      await handleDisconnect();
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPortRef.current = port;
      setTransport('serial');
      setDeviceLabel('USART1 ST-LINK (115200)');
      appendLog('USB', 'Відкрито USART1 115200 8N1');

      if (!port.readable) return;
      const decoder = new TextDecoderStream();
      const readableClosed = port.readable.pipeTo(
        decoder.writable as unknown as WritableStream<Uint8Array>
      );
      const reader = decoder.readable.getReader();

      let active = true;
      serialReaderCancelRef.current = async () => {
        active = false;
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        try {
          await readableClosed;
        } catch {
          // ignore
        }
      };

      let lineBuf = '';
      (async () => {
        try {
          while (active) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value) continue;
            lineBuf += value;
            const lines = lineBuf.split(/\r?\n/);
            lineBuf = lines.pop() ?? '';
            for (const rawLine of lines) {
              seqRef.current += 1;
              const parsed = parseTextTelemetryLine(rawLine, seqRef.current, 'usb-mcu');
              if (!parsed) continue;
              if (parsed.kind === 'imu') {
                pushImuSample(parsed.sample, true);
              } else if (parsed.kind === 'activity') {
                setCurrentActivity(parsed.prediction);
                setMissedSamples(parsed.prediction.missedSamples);
                setPredictions((prev) => [...prev, parsed.prediction].slice(-MAX_PREDICTIONS));
                appendLog(
                  'USB',
                  `MCU: ${ACTIVITY_CLASSES[parsed.prediction.activityId].label} (${parsed.prediction.confidence}%)`,
                  parsed.prediction.timestampMs,
                  rawLine
                );
              } else if (parsed.kind === 'missed') {
                setMissedSamples(parsed.count);
                appendLog('USB', `Пропущено семплів IMU: ${parsed.count}`, Date.now(), rawLine);
              } else if (parsed.kind === 'whoami') {
                setWhoAmI(parsed.idHex);
                appendLog('USB', `ISM330DHCX WHO_AM_I = ${parsed.idHex}`, Date.now(), rawLine);
              } else if (parsed.kind === 'ble_diag') {
                setBleDiag(parsed.ok ? 'AT OK' : 'Немає відповіді AT');
                appendLog('USB', parsed.line, Date.now(), rawLine);
              } else if (parsed.kind === 'info') {
                appendLog('USB', parsed.line);
              }
            }
          }
        } catch {
          if (active) {
            setTransport('disconnected');
            setDeviceLabel('Порт закрито');
          }
        }
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Помилка відкриття USB-порту';
      if (!msg.toLowerCase().includes('no port selected')) {
        setStatusError(msg);
      }
      setTransport('disconnected');
    }
  }, [appendLog, handleDisconnect, pushImuSample]);

  const togglePause = async () => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    if (transport === 'ble' && bleCtrlCharRef.current) {
      try {
        const code = nextPaused ? BLE_COMMANDS.PAUSE_STREAM : BLE_COMMANDS.START_STREAM;
        await bleCtrlCharRef.current.writeValue(new Uint8Array([code]));
        appendLog('CMD', nextPaused ? 'Пауза потоку (BLE)' : 'Продовження потоку (BLE)');
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : 'Помилка команди BLE');
      }
    }
  };

  const handleExportCsv = () => {
    if (samples.length > 0) {
      exportSamplesToCsv(samples);
    } else if (predictions.length > 0) {
      exportPredictionsToCsv(predictions);
    }
  };

  const handleClearSession = () => {
    samplesRef.current = [];
    seqRef.current = 0;
    setSamples([]);
    setPredictions([]);
    setLogs([]);
    setCurrentActivity(null);
    setMissedSamples(0);
  };

  const latestSample = samples[samples.length - 1] ?? null;
  const activeMeta = currentActivity ? ACTIVITY_CLASSES[currentActivity.activityId] : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
        <a
          href="#monitor"
          onClick={(e) => {
            e.preventDefault();
            setView('monitor');
          }}
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          U585 Activity Tracker
        </a>

        <nav className="flex items-center gap-7 text-sm font-medium">
          <button
            type="button"
            onClick={() => setView('monitor')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              view === 'monitor'
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Монітор
          </button>
          <button
            type="button"
            onClick={() => setView('analytics')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              view === 'analytics'
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Аналітика
          </button>
        </nav>

        <div className="shrink-0">
          {transport === 'disconnected' ? (
            <button
              type="button"
              onClick={handleConnectBle}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Bluetooth className="w-3.5 h-3.5" />
              Підключити BLE
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Відключити
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        <section className="bg-white border border-slate-200 rounded-lg px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-900">B-U585I-IOT02A</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">STM32U585</span>
              <span aria-hidden="true">·</span>
              <span>ISM330DHCX (26 Гц)</span>
              <span aria-hidden="true">·</span>
              <span>STM32WB5MMG</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
              <span
                className={
                  transport === 'disconnected'
                    ? 'text-slate-500'
                    : 'text-emerald-700 font-medium'
                }
              >
                {transport === 'disconnected'
                  ? '○ Очікування підключення'
                  : isPaused
                  ? `❚❚ Пауза · ${deviceLabel}`
                  : `● Підключено · ${deviceLabel}`}
              </span>
              {sampleRateHz > 0 && <span className="text-slate-500">· {sampleRateHz} Гц</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleConnectSerial}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                transport === 'serial'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
              }`}
            >
              <Usb className="w-3.5 h-3.5" />
              USB Serial (USART1)
            </button>

            <button
              type="button"
              onClick={togglePause}
              disabled={transport === 'disconnected'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-200 bg-white text-slate-700 hover:border-slate-300 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {isPaused ? 'Продовжити' : 'Пауза'}
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={samples.length === 0 && predictions.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-200 bg-white text-slate-700 hover:border-slate-300 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Експорт CSV
            </button>

            <button
              type="button"
              onClick={handleClearSession}
              disabled={samples.length === 0 && predictions.length === 0 && logs.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-200 bg-white text-slate-600 hover:text-rose-600 hover:border-rose-200 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Очистити
            </button>
          </div>
        </section>

        {statusError && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4 text-xs text-rose-800">
            <span>{statusError}</span>
            <button
              type="button"
              onClick={() => setStatusError(null)}
              className="font-medium underline shrink-0"
            >
              Закрити
            </button>
          </div>
        )}

        {view === 'monitor' && (
          <>
            {/* 4 KPI cards backed strictly by real board data */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-500">Поточна активність</div>
                <div
                  className="text-xl font-semibold mt-1 truncate"
                  style={{ color: activeMeta ? activeMeta.color : '#0F172A' }}
                >
                  {activeMeta ? activeMeta.label : 'Очікування'}
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                  {currentActivity
                    ? currentActivity.source === 'ble-mcu'
                      ? 'Джерело: STM32 BLE'
                      : currentActivity.source === 'usb-mcu'
                      ? 'Джерело: STM32 USB'
                      : 'Попередня оцінка з USB IMU'
                    : 'Підключіть плату'}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-500">Впевненість класифікації</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                  {currentActivity ? `${currentActivity.confidence}%` : '—'}
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                  Модель: st_ign_realworld_imu_27hz
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-500">Прийнято класифікацій</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                  {predictions.length}
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                  {currentActivity
                    ? `t плати: ${currentActivity.timestampMs} мс`
                    : latestSample
                    ? `|a|: ${latestSample.magnitudeA.toFixed(2)} м/с²`
                    : 'Час плати: —'}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-500">Стан IMU та BLE</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                  {missedSamples}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">пропусків IMU</span>
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                  WHO_AM_I: {whoAmI} · BLE: {transport === 'ble' ? 'GATT OK' : bleDiag}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Класи активності (5 класів)
                  </h2>
                  <span className="text-xs font-mono text-slate-500">27.45 Гц</span>
                </div>

                <div className="mt-3 space-y-2">
                  {(Object.keys(ACTIVITY_CLASSES) as unknown as ActivityId[]).map((id) => {
                    const cls = ACTIVITY_CLASSES[id];
                    const isActive = currentActivity?.activityId === id;
                    return (
                      <div
                        key={cls.id}
                        className={`px-3 py-2.5 rounded border transition-colors ${
                          isActive
                            ? 'border-blue-600 bg-blue-50/60'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">
                            {cls.id}. {cls.label}
                          </span>
                          <span
                            className="text-xs font-mono tabular-nums"
                            style={{ color: cls.color }}
                          >
                            {isActive ? 'Активний' : `ID ${cls.id}`}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{cls.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-8 space-y-5">
                <ImuWaveformChart samples={samples} />

                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Журнал подій та класифікацій
                    </h3>
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      Останні {logs.length} записів
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-64">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-2 font-medium">Час</th>
                          <th className="px-4 py-2 font-medium">Канал</th>
                          <th className="px-4 py-2 font-medium">Подія</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {logs.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-4 py-6 text-center font-sans text-slate-400">
                              Подій ще немає. Підключіть плату по BLE або USB Serial.
                            </td>
                          </tr>
                        ) : (
                          logs.map((entry) => (
                            <tr key={entry.id} className="hover:bg-slate-50/70">
                              <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                                {entry.timeStr}
                              </td>
                              <td className="px-4 py-2 font-semibold text-slate-700 whitespace-nowrap">
                                {entry.channel}
                              </td>
                              <td className="px-4 py-2 font-sans text-slate-800">
                                {entry.summary}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {view === 'analytics' && (
          <ActivityTimeline
            history={predictions}
            sampleCount={samples.length}
            missedSamples={missedSamples}
          />
        )}
      </main>
    </div>
  );
}
