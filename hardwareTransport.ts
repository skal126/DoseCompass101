import type { PacketLogEntry, TransportKind } from '../types/dispenser';

const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const DOSECOMPASS_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';

export interface TransportStateInfo {
  transport: TransportKind;
  deviceName: string | null;
  linkDetail: string | null;
  writeMode: string | null;
  canWrite: boolean;
}

interface TransportCallbacks {
  onStateChange?: (state: TransportStateInfo) => void;
  onLineReceived?: (line: string) => void;
  onLog?: (direction: PacketLogEntry['direction'], message: string) => void;
}

interface PendingWaiter {
  matcher: (line: string) => boolean;
  resolve: (result: { line: string; rttMs: number }) => void;
  reject: (error: Error) => void;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

// Minimal Web Bluetooth / Web Serial runtime bindings so TypeScript builds cleanly
// without requiring external @types/web-bluetooth packages.
interface BleCharacteristicLike {
  uuid: string;
  properties: {
    read: boolean;
    write: boolean;
    writeWithoutResponse: boolean;
    notify: boolean;
    indicate: boolean;
  };
  startNotifications(): Promise<BleCharacteristicLike>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  readValue(): Promise<DataView>;
  writeValueWithResponse?(data: BufferSource): Promise<void>;
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
  writeValue?(data: BufferSource): Promise<void>;
}

interface BleServiceLike {
  uuid: string;
  getCharacteristics(): Promise<BleCharacteristicLike[]>;
}

interface BleServerLike {
  connected: boolean;
  connect(): Promise<BleServerLike>;
  disconnect(): void;
  getPrimaryServices(): Promise<BleServiceLike[]>;
}

interface BleDeviceLike {
  name?: string;
  gatt?: BleServerLike;
  addEventListener(type: string, listener: () => void): void;
}

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

class HardwareTransportManager {
  private transport: TransportKind = 'disconnected';
  private callbacks: TransportCallbacks = {};
  private waiters: PendingWaiter[] = [];
  private busy = false;
  private rxBuffer = '';

  // BLE state
  private bleDevice: BleDeviceLike | null = null;
  private bleWriteChar: BleCharacteristicLike | null = null;
  private bleReadChar: BleCharacteristicLike | null = null;
  private bleWriteMode: string | null = null;

  // Serial state
  private serialPort: SerialPortLike | null = null;
  private serialReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private serialWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private serialKeepReading = false;

  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  setCallbacks(callbacks: TransportCallbacks): void {
    this.callbacks = callbacks;
  }

  getTransport(): TransportKind {
    return this.transport;
  }

  canWrite(): boolean {
    if (this.transport === 'ble') return this.bleWriteChar !== null;
    if (this.transport === 'serial') return this.serialWriter !== null;
    return false;
  }

  isBusy(): boolean {
    return this.busy;
  }

  private emitState(info: TransportStateInfo): void {
    this.transport = info.transport;
    this.callbacks.onStateChange?.(info);
  }

  private log(direction: PacketLogEntry['direction'], message: string): void {
    this.callbacks.onLog?.(direction, message);
  }

  private handleIncomingChunk(chunk: string): void {
    this.rxBuffer += chunk;
    const parts = this.rxBuffer.split(/\r?\n/);
    this.rxBuffer = parts.pop() ?? '';

    for (const rawLine of parts) {
      const line = rawLine.trim();
      if (!line) continue;
      this.log('rx', line);
      this.callbacks.onLineReceived?.(line);

      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i];
        if (waiter.matcher(line)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(i, 1);
          waiter.resolve({
            line,
            rttMs: Math.max(1, Math.round(performance.now() - waiter.startedAt)),
          });
        }
      }
    }
  }

  private clearAllWaiters(reason: string): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.pop()!;
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
  }

  async connectBluetooth(customServiceUuid?: string): Promise<{ canWrite: boolean; deviceName: string | null }> {
    const nav = navigator as Navigator & {
      bluetooth?: {
        requestDevice(options: Record<string, unknown>): Promise<BleDeviceLike>;
      };
    };

    if (!nav.bluetooth) {
      throw new Error(
        'Web Bluetooth is not supported in this browser. Use desktop Chrome/Edge over HTTPS or connect via USB Serial.',
      );
    }

    await this.disconnect();

    const optionalServices = [NUS_SERVICE_UUID, DOSECOMPASS_SERVICE_UUID];
    const trimmedCustom = (customServiceUuid ?? '').trim().toLowerCase();
    if (trimmedCustom && !optionalServices.includes(trimmedCustom)) {
      optionalServices.push(trimmedCustom);
    }

    this.log('info', 'Opening Chrome Bluetooth LE device chooser...');
    const device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices,
    });

    if (!device.gatt) {
      throw new Error('Selected Bluetooth device does not expose a GATT server.');
    }

    device.addEventListener('gattserverdisconnected', () => {
      this.log('info', 'Bluetooth LE device disconnected.');
      this.clearAllWaiters('Bluetooth LE disconnected while awaiting response.');
      this.bleDevice = null;
      this.bleWriteChar = null;
      this.bleReadChar = null;
      this.bleWriteMode = null;
      this.emitState({
        transport: 'disconnected',
        deviceName: null,
        linkDetail: null,
        writeMode: null,
        canWrite: false,
      });
    });

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();

    let foundWrite: BleCharacteristicLike | null = null;
    let foundRead: BleCharacteristicLike | null = null;
    let writeMode: string | null = null;

    for (const service of services) {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        if (ch.properties.notify || ch.properties.indicate) {
          await ch.startNotifications();
          ch.addEventListener('characteristicvaluechanged', (evt: Event) => {
            const target = evt.target as { value?: DataView } | null;
            if (!target?.value) return;
            const text = this.decoder.decode(target.value);
            this.handleIncomingChunk(text.endsWith('\n') ? text : `${text}\n`);
          });
          if (!foundRead) foundRead = ch;
        }
        if (!foundRead && ch.properties.read) {
          foundRead = ch;
        }
        if (!foundWrite && (ch.properties.write || ch.properties.writeWithoutResponse)) {
          foundWrite = ch;
          writeMode = ch.properties.write ? 'Write With Response' : 'Write Without Response';
        }
      }
    }

    this.bleDevice = device;
    this.bleWriteChar = foundWrite;
    this.bleReadChar = foundRead;
    this.bleWriteMode = writeMode;

    const deviceName = device.name || 'DoseCompass ESP32';
    const canWrite = foundWrite !== null;

    this.emitState({
      transport: 'ble',
      deviceName,
      linkDetail: `${services.length} GATT service(s)`,
      writeMode,
      canWrite,
    });

    this.log('info', `Connected to ${deviceName} via Bluetooth LE (${writeMode ?? 'Read-only'}).`);
    return { canWrite, deviceName };
  }

  async connectSerial(): Promise<void> {
    const nav = navigator as Navigator & {
      serial?: {
        requestPort(): Promise<SerialPortLike>;
      };
    };

    if (!nav.serial) {
      throw new Error(
        'Web Serial is not supported in this browser. Use desktop Chrome or Edge on Windows, macOS, or Linux.',
      );
    }

    await this.disconnect();

    this.log('info', 'Opening Chrome USB Serial port chooser (115200 baud)...');
    const port = await nav.serial.requestPort();
    await port.open({ baudRate: 115200 });

    if (!port.readable || !port.writable) {
      throw new Error('Selected serial port is not readable/writable.');
    }

    this.serialPort = port;
    this.serialWriter = port.writable.getWriter();
    this.serialKeepReading = true;

    this.emitState({
      transport: 'serial',
      deviceName: 'ESP32 USB Serial',
      linkDetail: '115200 baud · 8N1',
      writeMode: 'Serial Stream',
      canWrite: true,
    });

    this.log('info', 'Connected to ESP32 over USB Serial at 115200 baud.');
    void this.readSerialLoop(port.readable);
  }

  private async readSerialLoop(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    this.serialReader = reader;
    try {
      while (this.serialKeepReading) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          this.handleIncomingChunk(this.decoder.decode(value, { stream: true }));
        }
      }
    } catch (err) {
      if (this.serialKeepReading) {
        const msg = err instanceof Error ? err.message : 'USB Serial connection lost';
        this.log('error', msg);
      }
    } finally {
      reader.releaseLock();
      this.serialReader = null;
      if (this.transport === 'serial') {
        this.clearAllWaiters('USB Serial disconnected while awaiting response.');
        this.serialWriter = null;
        this.serialPort = null;
        this.emitState({
          transport: 'disconnected',
          deviceName: null,
          linkDetail: null,
          writeMode: null,
          canWrite: false,
        });
      }
    }
  }

  async disconnect(): Promise<void> {
    this.clearAllWaiters('Connection closed.');
    this.rxBuffer = '';

    if (this.bleDevice?.gatt?.connected) {
      this.bleDevice.gatt.disconnect();
    }
    this.bleDevice = null;
    this.bleWriteChar = null;
    this.bleReadChar = null;
    this.bleWriteMode = null;

    this.serialKeepReading = false;
    try {
      await this.serialReader?.cancel();
    } catch {
      // Ignore cancel errors
    }
    try {
      this.serialWriter?.releaseLock();
    } catch {
      // Ignore lock release errors
    }
    try {
      await this.serialPort?.close();
    } catch {
      // Ignore port close errors
    }
    this.serialReader = null;
    this.serialWriter = null;
    this.serialPort = null;

    if (this.transport !== 'disconnected') {
      this.emitState({
        transport: 'disconnected',
        deviceName: null,
        linkDetail: null,
        writeMode: null,
        canWrite: false,
      });
    }
  }

  async sendCommand(cmd: string, options?: { silent?: boolean }): Promise<void> {
    if (this.transport === 'disconnected') {
      throw new Error('No hardware device connected.');
    }

    this.busy = true;
    try {
      if (this.transport === 'ble') {
        if (!this.bleWriteChar) {
          throw new Error('Connected BLE device does not have a writable characteristic.');
        }
        const bytes = this.encoder.encode(`${cmd}\n`);
        if (this.bleWriteChar.properties.write && this.bleWriteChar.writeValueWithResponse) {
          await this.bleWriteChar.writeValueWithResponse(bytes);
        } else if (
          this.bleWriteChar.properties.writeWithoutResponse &&
          this.bleWriteChar.writeValueWithoutResponse
        ) {
          await this.bleWriteChar.writeValueWithoutResponse(bytes);
        } else if (this.bleWriteChar.writeValue) {
          await this.bleWriteChar.writeValue(bytes);
        }
      } else if (this.transport === 'serial') {
        if (!this.serialWriter) {
          throw new Error('USB Serial writer is unavailable.');
        }
        await this.serialWriter.write(this.encoder.encode(`${cmd}\n`));
      }

      if (!options?.silent) {
        this.log('tx', cmd);
      }
    } finally {
      this.busy = false;
    }
  }

  async sendAndWaitAck(
    cmd: string,
    matcher: (rx: string) => boolean,
    timeoutMs: number = 5000,
  ): Promise<{ line: string; rttMs: number }> {
    const startedAt = performance.now();
    const waitPromise = new Promise<{ line: string; rttMs: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for ESP32 acknowledgement`));
      }, timeoutMs);

      this.waiters.push({ matcher, resolve, reject, startedAt, timer });
    });

    await this.sendCommand(cmd);
    return waitPromise;
  }

  async sendBlePayloadAndWaitAck(
    payload: string,
    matcher: (rx: string) => boolean,
    timeoutMs: number = 15000,
  ): Promise<{ line: string; rttMs: number }> {
    if (this.transport !== 'ble' || !this.bleWriteChar) {
      throw new Error('Bluetooth LE writable characteristic is not connected.');
    }

    const startedAt = performance.now();
    const waitPromise = new Promise<{ line: string; rttMs: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for BLE servo acknowledgement`));
      }, timeoutMs);

      this.waiters.push({ matcher, resolve, reject, startedAt, timer });
    });

    this.busy = true;
    try {
      const bytes = this.encoder.encode(payload);
      if (this.bleWriteChar.properties.write && this.bleWriteChar.writeValueWithResponse) {
        await this.bleWriteChar.writeValueWithResponse(bytes);
      } else if (
        this.bleWriteChar.properties.writeWithoutResponse &&
        this.bleWriteChar.writeValueWithoutResponse
      ) {
        await this.bleWriteChar.writeValueWithoutResponse(bytes);
      } else if (this.bleWriteChar.writeValue) {
        await this.bleWriteChar.writeValue(bytes);
      }
      this.log('tx', payload);
    } finally {
      this.busy = false;
    }

    return waitPromise;
  }

  async pollDishSensor(silent: boolean = false): Promise<void> {
    if (this.transport !== 'ble' || !this.bleReadChar || !this.bleReadChar.properties.read) {
      return;
    }
    this.busy = true;
    try {
      const view = await this.bleReadChar.readValue();
      const text = this.decoder.decode(view).trim();
      if (text) {
        if (!silent) this.log('rx', text);
        this.callbacks.onLineReceived?.(text);
      }
    } finally {
      this.busy = false;
    }
  }
}

export const hardwareTransport = new HardwareTransportManager();
