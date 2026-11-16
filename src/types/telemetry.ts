export type ActivityId = 0 | 1 | 2 | 3 | 4;

export interface ActivityMeta {
  id: ActivityId;
  key: string;
  label: string;
  modelLabel: string;
  color: string;
  description: string;
}

/* Класи моделі st_ign_realworld_imu_27hz (27.45 Гц, вікно 55 / крок 27, g та deg/s) */
export const ACTIVITY_CLASSES: Record<ActivityId, ActivityMeta> = {
  0: {
    id: 0,
    key: 'lying',
    label: 'Лежання / Сон',
    modelLabel: 'Lying',
    color: '#4F46E5',
    description: 'Горизонтальне положення з мінімальними коливаннями по осях IMU',
  },
  1: {
    id: 1,
    key: 'stationary',
    label: 'Спокій / Сидіння',
    modelLabel: 'Stationary',
    color: '#64748B',
    description: 'Статична вертикальна поза (сидіння або стояння без руху)',
  },
  2: {
    id: 2,
    key: 'walking',
    label: 'Ходьба',
    modelLabel: 'Walking',
    color: '#2563EB',
    description: 'Періодичний рух помірної амплітуди (~1.6–2.2 Гц)',
  },
  3: {
    id: 3,
    key: 'running',
    label: 'Біг',
    modelLabel: 'Running',
    color: '#D97706',
    description: 'Високоамплітудні ударні піки та швидке обертання',
  },
  4: {
    id: 4,
    key: 'stairs',
    label: 'Сходи',
    modelLabel: 'Stairs',
    color: '#0891B2',
    description: 'Підйом або спуск сходами з характерною зміною вертикального прискорення',
  },
};

export interface ImuSample {
  seq: number;
  timestampMs: number;
  receivedAt: number;
  ax: number; // m/s^2
  ay: number; // m/s^2
  az: number; // m/s^2
  gx: number; // dps
  gy: number; // dps
  gz: number; // dps
  magnitudeA: number; // m/s^2
}

export interface ActivityPrediction {
  timestampMs: number;
  receivedAt: number;
  activityId: ActivityId;
  confidence: number; // 0..100 %
  missedSamples: number;
  source: 'ble-mcu' | 'usb-mcu' | 'usb-preview';
}

export interface TelemetryLogEntry {
  id: number;
  timeStr: string;
  timestampMs: number;
  channel: 'BLE' | 'USB' | 'CMD';
  summary: string;
  raw?: string;
}

export type TransportKind = 'disconnected' | 'ble' | 'serial';

export const GATT_UUIDS = {
  SERVICE: '12340000-1234-5678-9abc-def012345678',
  CHAR_ACTIVITY: '12340001-1234-5678-9abc-def012345678',
  CHAR_IMU: '12340002-1234-5678-9abc-def012345678',
  CHAR_CONTROL: '12340003-1234-5678-9abc-def012345678',
  NUS_SERVICE: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  NUS_TX: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  NUS_RX: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
} as const;

export const BLE_COMMANDS = {
  START_STREAM: 0x01,
  PAUSE_STREAM: 0x02,
  TOGGLE_LOW_POWER: 0x10,
} as const;
