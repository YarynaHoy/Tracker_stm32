interface BluetoothRemoteGATTCharacteristicMinimal extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristicMinimal>;
  writeValue(value: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTServiceMinimal {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristicMinimal>;
}

interface BluetoothRemoteGATTServerMinimal {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServerMinimal>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTServiceMinimal>;
}

interface BluetoothDeviceMinimal extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServerMinimal;
}

interface SerialPortMinimal {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface Navigator {
  bluetooth?: {
    requestDevice(options: {
      filters?: Array<{ services?: string[]; namePrefix?: string }>;
      acceptAllDevices?: boolean;
      optionalServices?: string[];
    }): Promise<BluetoothDeviceMinimal>;
  };
  serial?: {
    requestPort(options?: {
      filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
    }): Promise<SerialPortMinimal>;
  };
}
