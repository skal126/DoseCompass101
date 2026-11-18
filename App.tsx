import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bluetooth, BluetoothOff } from 'lucide-react';
import { DeviceManager } from './components/DeviceManager';
import { TodayAtAGlance } from './components/TodayAtAGlance';
import { DispenserControl } from './components/DispenserControl';
import { CaregiverDashboard } from './components/CaregiverDashboard';
import { hardwareTransport } from './services/hardwareTransport';
import type {
  AdherenceLogEntry,
  CompartmentSlot,
  DishSensorState,
  DoseDelay,
  HardwareTelemetry,
  PacketLogEntry,
  StockLevel,
  TodayDoseItem,
  TransportKind,
} from './types/dispenser';
import {
  addDaysToDateKey,
  addMinutesToHHMM,
  buildClockSyncCommand,
  getBrowserTimezone,
  getSignedMinutesDelta,
  getTimezoneSnapshot,
} from './utils/timezone';

type ActiveTab = 'overview' | 'dispenser' | 'caregiver';

const LEGACY_SLOTS_KEY_V2 = 'dosecompass_slots_13_v2';

const STORAGE_KEYS = {
  slots: 'dosecompass_slots_4_esp32_v1',
  delays: 'dosecompass_delays_v2',
  logs: 'dosecompass_adherence_v2',
  timezone: 'dosecompass_timezone_v2',
  use24Hour: 'dosecompass_24h_v2',
  customBleUuid: 'dosecompass_custom_ble_uuid_v2',
};

const ALL_DAYS = [true, true, true, true, true, true, true];

const DEFAULT_SLOTS: CompartmentSlot[] = [
  {
    slot: 1,
    courseDays: 365,
    medicationName: 'Metformin',
    dosagePills: 1,
    dispenseTimes: ['08:00', '20:00'],
    days: [...ALL_DAYS],
    stockLevel: 'full',
    enabled: false,
    lastDispensedAt: null,
    lastStatus: 'idle',
  },
  {
    slot: 2,
    courseDays: 365,
    medicationName: 'Lisinopril',
    dosagePills: 1,
    dispenseTimes: ['08:30'],
    days: [...ALL_DAYS],
    stockLevel: 'medium',
    enabled: false,
    lastDispensedAt: null,
    lastStatus: 'idle',
  },
  {
    slot: 3,
    courseDays: 365,
    medicationName: 'Vitamin D3',
    dosagePills: 2,
    dispenseTimes: ['12:00'],
    days: [...ALL_DAYS],
    stockLevel: 'full',
    enabled: false,
    lastDispensedAt: null,
    lastStatus: 'idle',
  },
  {
    slot: 4,
    courseDays: 365,
    medicationName: 'Atorvastatin',
    dosagePills: 1,
    dispenseTimes: ['21:00'],
    days: [...ALL_DAYS],
    stockLevel: 'medium',
    enabled: false,
    lastDispensedAt: null,
    lastStatus: 'idle',
  },
];

function dateKeyToEpochDay(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function buildEsp32PlanCommand(slot: CompartmentSlot): string {
  const startDay = dateKeyToEpochDay(
    slot.startDateKey ||
      addDaysToDateKey(getTimezoneSnapshot(getBrowserTimezone()).dateKey, 1),
  );
  const times = slot.dispenseTimes
    .slice(0, 8)
    .map((time) => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    })
    .filter((minute) => Number.isInteger(minute) && minute >= 0 && minute <= 1439);
  const firmwareEnabled = slot.enabled && slot.days.every(Boolean) && times.length > 0;
  const courseDays = Math.min(365, Math.max(1, Number(slot.courseDays) || 365));
  const safeName = slot.medicationName
    .replace(/[|\r\n]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, 24);
  return `P ${slot.slot - 1} ${firmwareEnabled ? 1 : 0} ${startDay} ${courseDays} ${times.length} ${times.join(' ')}|${safeName}`;
}

function loadSavedJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [transport, setTransport] = useState<TransportKind>('disconnected');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncingClock, setIsSyncingClock] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [customBleServiceUuid, setCustomBleServiceUuid] = useState<string>(() =>
    loadSavedJson<string>(STORAGE_KEYS.customBleUuid, ''),
  );

  const [timezone, setTimezone] = useState<string>(() =>
    loadSavedJson<string>(STORAGE_KEYS.timezone, getBrowserTimezone()),
  );
  const [use24Hour, setUse24Hour] = useState<boolean>(() =>
    loadSavedJson<boolean>(STORAGE_KEYS.use24Hour, false),
  );
  const [autoSyncClock, setAutoSyncClock] = useState<boolean>(true);
  const [firmwarePlansSynced, setFirmwarePlansSynced] = useState<boolean>(false);
  const [nowDate, setNowDate] = useState<Date>(() => new Date());

  const [slots, setSlots] = useState<CompartmentSlot[]>(() => {
    const initialTz = loadSavedJson<string>(STORAGE_KEYS.timezone, getBrowserTimezone());
    const initialTomorrowKey = addDaysToDateKey(
      getTimezoneSnapshot(initialTz, new Date()).dateKey,
      1,
    );
    const savedFour = loadSavedJson<CompartmentSlot[] | null>(STORAGE_KEYS.slots, null);
    const savedOld = loadSavedJson<CompartmentSlot[] | null>('dosecompass_slots_13_v3', null);
    const legacyV2 = loadSavedJson<CompartmentSlot[] | null>(LEGACY_SLOTS_KEY_V2, null);
    const source =
      Array.isArray(savedFour) && savedFour.length >= 4
        ? savedFour
        : Array.isArray(savedOld) && savedOld.length >= 4
          ? savedOld
          : Array.isArray(legacyV2) && legacyV2.length >= 4
            ? legacyV2
            : DEFAULT_SLOTS;
    return source.slice(0, 4).map((slot, index) => ({
      ...slot,
      slot: index + 1,
      courseDays: Math.min(365, Math.max(1, Number(slot.courseDays) || 365)),
      dispenseTimes:
        Array.isArray(slot.dispenseTimes) && slot.dispenseTimes.length
          ? slot.dispenseTimes.slice(0, 8)
          : ['08:00'],
      days: Array.isArray(slot.days) && slot.days.length === 7 ? slot.days : [...ALL_DAYS],
      startDateKey: slot.startDateKey || initialTomorrowKey,
    }));
  });
  const [delays, setDelays] = useState<DoseDelay[]>(() =>
    loadSavedJson<DoseDelay[]>(STORAGE_KEYS.delays, []),
  );
  const [adherenceLogs, setAdherenceLogs] = useState<AdherenceLogEntry[]>(() =>
    loadSavedJson<AdherenceLogEntry[]>(STORAGE_KEYS.logs, []),
  );
  const [packetLogs, setPacketLogs] = useState<PacketLogEntry[]>([]);

  const [dishSensor, setDishSensor] = useState<DishSensorState>({
    weightGrams: null,
    status: 'disconnected',
    lastUpdatedAt: null,
    lastTaredAt: null,
  });
  const [dishRefreshMs, setDishRefreshMs] = useState<number>(2000);
  const lastDishPushMsRef = useRef<number>(0);

  const [telemetry, setTelemetry] = useState<HardwareTelemetry>({
    deviceName: null,
    linkDetail: null,
    writeMode: null,
    lastRttMs: null,
    lastClockSyncAt: null,
    lastClockSyncTz: null,
    pendingDropSlot: null,
  });

  const triggeredScheduleKeysRef = useRef<Set<string>>(new Set());
  const pendingDropSlotRef = useRef<number | null>(null);
  const clockSnapshot = useMemo(
    () => getTimezoneSnapshot(timezone, nowDate),
    [timezone, nowDate],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setNowDate(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.slots, JSON.stringify(slots));
      localStorage.setItem(STORAGE_KEYS.delays, JSON.stringify(delays));
      localStorage.setItem(STORAGE_KEYS.logs, JSON.stringify(adherenceLogs));
      localStorage.setItem(STORAGE_KEYS.timezone, JSON.stringify(timezone));
      localStorage.setItem(STORAGE_KEYS.use24Hour, JSON.stringify(use24Hour));
      localStorage.setItem(STORAGE_KEYS.customBleUuid, JSON.stringify(customBleServiceUuid));
    } catch {
      // Ignore storage quota issues
    }
  }, [slots, delays, adherenceLogs, timezone, use24Hour, customBleServiceUuid]);

  const appendPacketLog = useCallback(
    (direction: PacketLogEntry['direction'], message: string) => {
      setPacketLogs((prev) => [
        ...prev.slice(-149),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          direction,
          transport: hardwareTransport.getTransport(),
          message,
          timestamp: new Date().toISOString(),
        },
      ]);
    },
    [],
  );

  useEffect(() => {
    hardwareTransport.setCallbacks({
      onStateChange: (next) => {
        setTransport(next.transport);
        setTelemetry((prev) => ({
          ...prev,
          deviceName: next.deviceName,
          linkDetail: next.linkDetail,
          writeMode: next.writeMode,
          pendingDropSlot: next.transport === 'disconnected' ? null : prev.pendingDropSlot,
        }));
        if (next.transport === 'disconnected') {
          setDishSensor((prev) => ({
            ...prev,
            status: 'disconnected',
          }));
        }
      },
      onLineReceived: (line) => {
        const upper = line.toUpperCase();

        const dispensedMatch = line.match(/^ACK:DISPENSED:(\d+)$/i);
        if (dispensedMatch) {
          const slotNum = Number(dispensedMatch[1]) + 1;
          const nowIso = new Date().toISOString();
          setSlots((prev) =>
            prev.map((slot) =>
              slot.slot === slotNum
                ? { ...slot, lastStatus: 'dispensed', lastDispensedAt: nowIso, lastError: undefined }
                : slot,
            ),
          );
          setDishSensor((prev) => ({ ...prev, status: 'awaiting_drop' }));
          if (pendingDropSlotRef.current !== slotNum) {
            const target = slots.find((slot) => slot.slot === slotNum);
            if (target) {
              setAdherenceLogs((prev) => [
                {
                  id: `${Date.now()}-${slotNum}-firmware`,
                  slot: slotNum,
                  medicationName: target.medicationName,
                  dosagePills: target.dosagePills,
                  scheduledTime: getTimezoneSnapshot(timezone, new Date()).time24.slice(0, 5),
                  timezone,
                  status: 'dispensed',
                  source: hardwareTransport.getTransport() === 'ble' ? 'ble' : 'serial',
                  timestamp: nowIso,
                  note: 'Completed by ESP32 saved schedule',
                },
                ...prev,
              ]);
            }
          }
          return;
        }

        const servoDoneMatch = line.match(/^SERVO\s+(\d+)\s+DONE$/i);
        if (servoDoneMatch) {
          const slotNum = Number(servoDoneMatch[1]) + 1;
          const nowIso = new Date().toISOString();
          setSlots((prev) =>
            prev.map((slot) =>
              slot.slot === slotNum
                ? { ...slot, lastStatus: 'dispensed', lastDispensedAt: nowIso, lastError: undefined }
                : slot,
            ),
          );
          setDishSensor((prev) => ({ ...prev, status: 'awaiting_drop' }));
          if (pendingDropSlotRef.current !== slotNum) {
            const target = slots.find((slot) => slot.slot === slotNum);
            if (target) {
              setAdherenceLogs((prev) => [
                {
                  id: `${Date.now()}-${slotNum}-firmware`,
                  slot: slotNum,
                  medicationName: target.medicationName,
                  dosagePills: target.dosagePills,
                  scheduledTime: getTimezoneSnapshot(timezone, new Date()).time24.slice(0, 5),
                  timezone,
                  status: 'dispensed',
                  source: hardwareTransport.getTransport() === 'ble' ? 'ble' : 'serial',
                  timestamp: nowIso,
                  note: 'Completed by ESP32 saved schedule',
                },
                ...prev,
              ]);
            }
          }
          return;
        }

        if (upper.startsWith('DROPPED:')) {
          const slotNum = Number(line.split(':')[1]);
          if (!Number.isNaN(slotNum)) {
            setSlots((prev) =>
              prev.map((s) =>
                s.slot === slotNum
                  ? {
                      ...s,
                      lastStatus: 'dispensed',
                      lastDispensedAt: new Date().toISOString(),
                      lastError: undefined,
                    }
                  : s,
              ),
            );
            setDishSensor((prev) => ({ ...prev, status: 'awaiting_drop' }));
          }
          return;
        }

        if (upper.startsWith('STOCK:')) {
          const parts = line.split(':');
          const slotNum = Number(parts[1]);
          const level = (parts[2] ?? '').toLowerCase() as StockLevel;
          if (
            !Number.isNaN(slotNum) &&
            (level === 'low' || level === 'medium' || level === 'full' || level === 'empty')
          ) {
            setSlots((prev) =>
              prev.map((s) => (s.slot === slotNum ? { ...s, stockLevel: level } : s)),
            );
          }
          return;
        }

        if (upper.startsWith('ERR:') || upper.startsWith('ERR ') || upper.startsWith('ERROR:')) {
          appendPacketLog('error', `ESP32 reported error: ${line}`);
          return;
        }

        let parsedGrams: number | null = null;
        let stateHint = '';

        if (line.startsWith('{')) {
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            const rawVal = obj.weight ?? obj.grams ?? obj.dish ?? obj.hx711;
            if (typeof rawVal === 'number' || typeof rawVal === 'string') {
              const num = Number(rawVal);
              if (Number.isFinite(num)) parsedGrams = num;
            }
            if (typeof obj.state === 'string') stateHint = obj.state.toUpperCase();
          } catch {
            // Not valid JSON
          }
        } else {
          const taggedMatch = line.match(
            /^(?:dish|weight|hx711|w|grams?)\s*[:=]\s*(-?\d+(?:\.\d+)?)(?:\s*[:=]\s*([a-z_]+))?/i,
          );
          if (taggedMatch) {
            parsedGrams = parseFloat(taggedMatch[1]);
            stateHint = (taggedMatch[2] ?? '').toUpperCase();
          } else {
            const plainMatch = line.match(/^(-?\d+(?:\.\d+)?)\s*(?:g|grams?)?$/i);
            if (plainMatch) {
              parsedGrams = parseFloat(plainMatch[1]);
            }
          }
        }

        if (parsedGrams !== null && Number.isFinite(parsedGrams)) {
          const clamped = Math.max(0, parsedGrams);
          const detected =
            stateHint === 'PILL_DETECTED' ||
            (stateHint !== 'EMPTY' && clamped >= 0.08);
          lastDishPushMsRef.current = Date.now();
          setDishSensor((prev) => ({
            ...prev,
            weightGrams: clamped,
            status: detected ? 'pill_detected' : 'empty',
            lastUpdatedAt: new Date().toISOString(),
          }));
        }
      },
      onLog: (direction, message) => {
        appendPacketLog(direction, message);
      },
    });
  }, [appendPacketLog, slots, timezone]);

  useEffect(() => {
    if (transport === 'disconnected' || dishRefreshMs <= 0) return;

    const timer = setInterval(() => {
      if (hardwareTransport.isBusy() || telemetry.pendingDropSlot !== null) return;
      const sinceLastPush = Date.now() - lastDishPushMsRef.current;
      if (sinceLastPush < dishRefreshMs * 0.75) return;

      if (transport === 'ble') {
        void hardwareTransport.pollDishSensor(true).catch(() => undefined);
      } else if (transport === 'serial') {
        void hardwareTransport.sendCommand('w', { silent: true }).catch(() => undefined);
      }
    }, dishRefreshMs);

    return () => clearInterval(timer);
  }, [transport, dishRefreshMs, telemetry.pendingDropSlot]);

  const syncClockToDevice = useCallback(
    async (targetTz: string = timezone) => {
      if (hardwareTransport.getTransport() !== 'serial') {
        appendPacketLog(
          'info',
          'ESP32 clock sync is available over USB Serial; the current BLE write protocol accepts only a servo index.',
        );
        return;
      }
      setIsSyncingClock(true);
      try {
        const { command, snapshot } = buildClockSyncCommand(targetTz, new Date());
        await hardwareTransport.sendCommand(command);
        setTelemetry((prev) => ({
          ...prev,
          lastClockSyncAt: new Date().toISOString(),
          lastClockSyncTz: `${snapshot.ianaTimezone} (${snapshot.offsetLabel})`,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Clock sync failed';
        appendPacketLog('error', msg);
      } finally {
        setIsSyncingClock(false);
      }
    },
    [timezone, appendPacketLog],
  );

  const handleConnectBle = async () => {
    setConnectionError(null);
    setIsConnecting(true);
    try {
      const conn = await hardwareTransport.connectBluetooth(customBleServiceUuid);
      if (!conn.canWrite) {
        await hardwareTransport.disconnect();
        throw new Error(
          'ESP32 BLE connection is read-only; reconnect and select its writable dispenser characteristic.',
        );
      }
      void hardwareTransport.pollDishSensor(false).catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect Bluetooth device';
      setConnectionError(msg);
      appendPacketLog('error', msg);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnectSerial = async () => {
    setConnectionError(null);
    setIsConnecting(true);
    try {
      await hardwareTransport.connectSerial();
      setFirmwarePlansSynced(false);
      if (autoSyncClock) await syncClockToDevice(timezone);
      await hardwareTransport.sendCommand('P?');
      void hardwareTransport.sendCommand('w').catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open 115200 USB Serial port';
      setConnectionError(msg);
      appendPacketLog('error', msg);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSyncPlans = async () => {
    if (hardwareTransport.getTransport() !== 'serial') {
      setConnectionError('Connect through USB Serial before synchronizing schedules to the ESP32.');
      return;
    }
    try {
      for (const slot of slots) {
        await hardwareTransport.sendCommand(buildEsp32PlanCommand(slot));
      }
      await hardwareTransport.sendCommand('P?');
      setFirmwarePlansSynced(true);
      appendPacketLog(
        'info',
        'All four compartment plans sent to ESP32. Check PLAN/STAT responses in the packet console.',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to synchronize ESP32 plans';
      setConnectionError(msg);
      appendPacketLog('error', msg);
    }
  };

  const handleDisconnect = async () => {
    setConnectionError(null);
    await hardwareTransport.disconnect();
  };

  const handleTimezoneChange = (nextTz: string) => {
    setTimezone(nextTz);
    if (autoSyncClock && hardwareTransport.getTransport() === 'serial') {
      void syncClockToDevice(nextTz);
    }
  };

  const handlePingDevice = async () => {
    setConnectionError(null);
    try {
      if (hardwareTransport.getTransport() === 'ble') {
        appendPacketLog('info', 'BLE is connected; this firmware does not implement a PING command.');
        return;
      }
      await hardwareTransport.sendCommand('P?');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ping timed out';
      setConnectionError(msg);
      appendPacketLog('error', msg);
    }
  };

  const handleSendRawCommand = async (cmd: string) => {
    try {
      await hardwareTransport.sendCommand(cmd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send command';
      appendPacketLog('error', msg);
    }
  };

  const handleReadDish = async () => {
    try {
      if (hardwareTransport.getTransport() === 'ble') {
        await hardwareTransport.pollDishSensor(false);
      } else if (hardwareTransport.getTransport() === 'serial') {
        await hardwareTransport.sendCommand('w');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read dish sensor';
      appendPacketLog('error', msg);
    }
  };

  const handleTareDish = async () => {
    try {
      if (hardwareTransport.getTransport() !== 'serial') {
        throw new Error(
          'The attached ESP32 firmware supports tare only over USB Serial (send command t).',
        );
      }
      const { line } = await hardwareTransport.sendAndWaitAck(
        't',
        (response) => response === 'Tared' || response.startsWith('ERR '),
        2500,
      );
      if (line !== 'Tared') throw new Error(`ESP32 tare failed: ${line}`);
      setDishSensor((prev) => ({ ...prev, lastTaredAt: new Date().toISOString() }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to tare dish scale';
      appendPacketLog('error', msg);
    }
  };

  const handleDropPill = useCallback(
    async (
      slotNumber: number,
      triggerSource: 'manual' | 'schedule' = 'manual',
      scheduledTimeOverride?: string,
    ) => {
      const currentTransport = hardwareTransport.getTransport();
      if (currentTransport === 'disconnected') {
        setConnectionError(
          'Connect the ESP32 via Chrome Bluetooth LE or USB Serial (115200 baud) before dispensing.',
        );
        return;
      }
      if (!hardwareTransport.canWrite()) {
        setConnectionError(
          'Connected Bluetooth device is read-only/sensor-only and does not expose a writable command characteristic.',
        );
        return;
      }

      const targetSlot = slots.find((s) => s.slot === slotNumber);
      if (!targetSlot) return;

      const scheduledLabel = scheduledTimeOverride ?? targetSlot.dispenseTimes[0] ?? '08:00';

      setConnectionError(null);
      setTelemetry((prev) => ({ ...prev, pendingDropSlot: slotNumber }));
      setSlots((prev) =>
        prev.map((s) =>
          s.slot === slotNumber
            ? { ...s, lastStatus: 'dispensing', lastError: undefined }
            : s,
        ),
      );

      try {
        const firmwareIndex = slotNumber - 1;
        pendingDropSlotRef.current = slotNumber;
        const matcher = (rx: string) =>
          (currentTransport === 'ble'
            ? rx === `ACK:DISPENSED:${firmwareIndex}`
            : rx === `SERVO ${firmwareIndex} DONE`) ||
          rx.startsWith('ERROR:') ||
          rx.startsWith('ERR ');
        const result =
          currentTransport === 'ble'
            ? await hardwareTransport.sendBlePayloadAndWaitAck(String(firmwareIndex), matcher, 15000)
            : currentTransport === 'serial'
              ? await hardwareTransport.sendAndWaitAck(`G ${firmwareIndex}`, matcher, 15000)
              : (() => {
                  throw new Error(
                    'The attached ESP32 firmware supports BLE GATT and USB Serial, not MQTT.',
                  );
                })();
        const { line, rttMs } = result;
        if (line.startsWith('ERROR:') || line.startsWith('ERR ')) {
          throw new Error(`ESP32 returned ${line}`);
        }

        const nowIso = new Date().toISOString();
        setTelemetry((prev) => ({ ...prev, lastRttMs: rttMs }));
        setDishSensor((prev) => ({ ...prev, status: 'awaiting_drop' }));
        setSlots((prev) =>
          prev.map((s) =>
            s.slot === slotNumber
              ? {
                  ...s,
                  lastDispensedAt: nowIso,
                  lastStatus: 'dispensed',
                  lastError: undefined,
                }
              : s,
          ),
        );

        setDelays((prev) =>
          prev.filter(
            (d) =>
              !(
                d.slot === slotNumber &&
                d.originalTime === scheduledLabel &&
                d.dateKey === clockSnapshot.dateKey
              ),
          ),
        );

        setAdherenceLogs((prev) => [
          {
            id: `${Date.now()}-${slotNumber}`,
            slot: slotNumber,
            medicationName: targetSlot.medicationName,
            dosagePills: targetSlot.dosagePills,
            scheduledTime: scheduledLabel,
            timezone,
            status: 'dispensed',
            source:
              triggerSource === 'schedule'
                ? 'schedule'
                : currentTransport === 'ble'
                  ? 'ble'
                  : currentTransport === 'mqtt'
                    ? 'mqtt'
                    : 'serial',
            timestamp: nowIso,
            note: `Hardware ACK (${rttMs} ms)`,
          },
          ...prev,
        ]);
      } catch (err) {
        const rawErrMsg = err instanceof Error ? err.message : 'Dispense command failed';
        const errMsg = rawErrMsg.toLowerCase().includes('timed out')
          ? `${rawErrMsg}. Check the physical tray and servo position before retrying; the cycle may have completed without its acknowledgement.`
          : rawErrMsg;
        setSlots((prev) =>
          prev.map((s) =>
            s.slot === slotNumber
              ? { ...s, lastStatus: 'error', lastError: errMsg }
              : s,
          ),
        );
        setAdherenceLogs((prev) => [
          {
            id: `${Date.now()}-${slotNumber}-err`,
            slot: slotNumber,
            medicationName: targetSlot.medicationName,
            dosagePills: targetSlot.dosagePills,
            scheduledTime: scheduledLabel,
            timezone,
            status: 'error',
            source:
              currentTransport === 'ble'
                ? 'ble'
                : currentTransport === 'mqtt'
                  ? 'mqtt'
                  : 'serial',
            timestamp: new Date().toISOString(),
            note: errMsg,
          },
          ...prev,
        ]);
        appendPacketLog('error', errMsg);
      } finally {
        pendingDropSlotRef.current = null;
        setTelemetry((prev) => ({ ...prev, pendingDropSlot: null }));
      }
    },
    [slots, timezone, clockSnapshot.dateKey, appendPacketLog],
  );

  const handleDelayDose = async (slotNum: number, originalTime: string, minutes: number) => {
    const slotConfig = slots.find((slot) => slot.slot === slotNum);
    if (slotConfig?.days.every(Boolean)) {
      appendPacketLog(
        'info',
        'One-time delay is not supported for ESP32 daily plans. Edit the daily plan and synchronize over USB Serial instead.',
      );
      return;
    }
    const existing = delays.find(
      (d) =>
        d.slot === slotNum &&
        d.originalTime === originalTime &&
        d.dateKey === clockSnapshot.dateKey,
    );
    const baseTime = existing ? existing.delayedToTime : originalTime;
    const totalMinutes = (existing ? existing.delayMinutes : 0) + minutes;
    const nextTime = addMinutesToHHMM(baseTime, minutes);

    setDelays((prev) => [
      ...prev.filter(
        (d) =>
          !(
            d.slot === slotNum &&
            d.originalTime === originalTime &&
            d.dateKey === clockSnapshot.dateKey
          ),
      ),
      {
        slot: slotNum,
        originalTime,
        delayedToTime: nextTime,
        delayMinutes: totalMinutes,
        dateKey: clockSnapshot.dateKey,
      },
    ]);

    appendPacketLog(
      'info',
      `Delayed Slot ${slotNum} (${originalTime}) by +${minutes}m -> ${nextTime}`,
    );
  };

  const handleCancelDelay = (slotNum: number, originalTime: string) => {
    setDelays((prev) =>
      prev.filter(
        (d) =>
          !(
            d.slot === slotNum &&
            d.originalTime === originalTime &&
            d.dateKey === clockSnapshot.dateKey
          ),
      ),
    );
  };

  const todayDoses = useMemo<TodayDoseItem[]>(() => {
    const items: TodayDoseItem[] = [];

    for (const slot of slots) {
      if (!slot.enabled) continue;
      if (slot.startDateKey && clockSnapshot.dateKey < slot.startDateKey) continue;
      const firstDay = dateKeyToEpochDay(slot.startDateKey || clockSnapshot.dateKey);
      const todayDay = dateKeyToEpochDay(clockSnapshot.dateKey);
      const courseDays = Math.min(365, Math.max(1, Number(slot.courseDays) || 365));
      if (todayDay >= firstDay + courseDays) continue;
      if (!slot.days[clockSnapshot.dayOfWeek]) continue;

      for (const originalTime of slot.dispenseTimes) {
        const delay = delays.find(
          (d) =>
            d.slot === slot.slot &&
            d.originalTime === originalTime &&
            d.dateKey === clockSnapshot.dateKey,
        );
        const effectiveTime = delay ? delay.delayedToTime : originalTime;

        const alreadyDispensedToday = adherenceLogs.some((log) => {
          if (log.slot !== slot.slot || log.scheduledTime !== originalTime) return false;
          if (log.status !== 'dispensed' && log.status !== 'taken') return false;
          const logSnap = getTimezoneSnapshot(timezone, new Date(log.timestamp));
          return logSnap.dateKey === clockSnapshot.dateKey;
        });

        const minutesDelta = getSignedMinutesDelta(effectiveTime, clockSnapshot);

        let state: TodayDoseItem['state'] = 'upcoming';
        if (alreadyDispensedToday) {
          state = 'dispensed';
        } else if (minutesDelta <= 0 && minutesDelta >= -5) {
          state = 'due';
        } else if (minutesDelta < -5) {
          state = 'missed';
        } else if (delay) {
          state = 'delayed';
        }

        items.push({
          key: `${slot.slot}-${originalTime}`,
          slot: slot.slot,
          medicationName: slot.medicationName,
          dosagePills: slot.dosagePills,
          originalTime,
          effectiveTime,
          delayMinutes: delay?.delayMinutes ?? 0,
          stockLevel: slot.stockLevel,
          state,
          minutesDelta,
        });
      }
    }

    return items.sort((a, b) => a.effectiveTime.localeCompare(b.effectiveTime));
  }, [slots, delays, adherenceLogs, clockSnapshot, timezone]);

  useEffect(() => {
    if (transport !== 'serial' || !firmwarePlansSynced || telemetry.pendingDropSlot !== null) return;

    const currentHHMM = clockSnapshot.time24.slice(0, 5);

    for (const dose of todayDoses) {
      if (dose.state === 'dispensed' || dose.stockLevel === 'empty') continue;
      const slotConfig = slots.find((slot) => slot.slot === dose.slot);
      if (slotConfig?.days.every(Boolean)) continue;
      if (dose.effectiveTime !== currentHHMM) continue;

      const dedupeKey = `${clockSnapshot.dateKey}-${currentHHMM}-S${dose.slot}-${dose.originalTime}-${timezone}`;
      if (triggeredScheduleKeysRef.current.has(dedupeKey)) continue;

      triggeredScheduleKeysRef.current.add(dedupeKey);
      appendPacketLog(
        'info',
        `Scheduled dose due in ${timezone} (${currentHHMM}): triggering servo ${dose.slot - 1}`,
      );
      void handleDropPill(dose.slot, 'schedule', dose.originalTime);
      break;
    }
  }, [
    transport,
    firmwarePlansSynced,
    telemetry.pendingDropSlot,
    clockSnapshot.time24,
    clockSnapshot.dateKey,
    todayDoses,
    slots,
    timezone,
    appendPacketLog,
    handleDropPill,
  ]);

  const handleUpdateSlot = (updated: CompartmentSlot) => {
    const previous = slots.find((slot) => slot.slot === updated.slot);
    setSlots((prev) => prev.map((slot) => (slot.slot === updated.slot ? updated : slot)));
    const scheduleChanged =
      !previous ||
      previous.enabled !== updated.enabled ||
      previous.medicationName !== updated.medicationName ||
      previous.startDateKey !== updated.startDateKey ||
      previous.courseDays !== updated.courseDays ||
      JSON.stringify(previous.dispenseTimes) !== JSON.stringify(updated.dispenseTimes) ||
      JSON.stringify(previous.days) !== JSON.stringify(updated.days);
    if (!scheduleChanged) return;
    if (hardwareTransport.getTransport() === 'serial') {
      void hardwareTransport.sendCommand(buildEsp32PlanCommand(updated)).catch((err) => {
        setFirmwarePlansSynced(false);
        appendPacketLog('error', err instanceof Error ? err.message : 'Failed to sync plan to ESP32');
      });
    } else if (hardwareTransport.getTransport() === 'ble') {
      setFirmwarePlansSynced(false);
      appendPacketLog(
        'info',
        'Schedule changed in the app only. The ESP32 keeps its previously saved plan until you connect USB Serial and sync plans.',
      );
    } else {
      setFirmwarePlansSynced(false);
    }
  };

  const handleMarkStatus = (entryId: string, status: 'taken' | 'missed') => {
    setAdherenceLogs((prev) =>
      prev.map((entry) => (entry.id === entryId ? { ...entry, status } : entry)),
    );
  };

  const lowStockCount = useMemo(
    () => slots.filter((s) => s.stockLevel === 'low' || s.stockLevel === 'empty').length,
    [slots],
  );

  const queuedForTomorrowCount = useMemo(
    () =>
      slots.filter(
        (s) => s.enabled && s.startDateKey && s.startDateKey > clockSnapshot.dateKey,
      ).length,
    [slots, clockSnapshot.dateKey],
  );

  const isConnected = transport !== 'disconnected';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('overview');
            }}
            className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
          >
            DoseCompass
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            {(
              [
                { id: 'overview', label: 'Control Center' },
                { id: 'dispenser', label: '4 Servos' },
                { id: 'caregiver', label: 'Caregiver Log' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  activeTab === item.id
                    ? 'text-slate-900 border-sky-700 font-semibold'
                    : 'text-slate-600 border-transparent hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="shrink-0">
            {isConnected ? (
              <button
                type="button"
                onClick={() => void handleDisconnect()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <BluetoothOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Disconnect</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleConnectBle()}
                disabled={isConnecting}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Bluetooth className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isConnecting ? 'Pairing...' : 'Connect Bluetooth'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="md:hidden border-t border-slate-100 px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium">
          {(
            [
              { id: 'overview', label: 'Control Center' },
              { id: 'dispenser', label: '4 Servos' },
              { id: 'caregiver', label: 'Caregiver Log' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-1 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === item.id
                  ? 'text-sky-700 font-semibold'
                  : 'text-slate-600'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main id="top" className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">
        {activeTab === 'overview' && (
          <>
            <TodayAtAGlance
              todayDoses={todayDoses}
              dishSensor={dishSensor}
              dishRefreshMs={dishRefreshMs}
              onChangeDishRefreshMs={setDishRefreshMs}
              transport={transport}
              pendingDropSlot={telemetry.pendingDropSlot}
              clockSnapshot={clockSnapshot}
              use24Hour={use24Hour}
              onDropDose={(slotNum, origTime) =>
                handleDropPill(slotNum, 'manual', origTime)
              }
              onDelayDose={handleDelayDose}
              onCancelDelay={handleCancelDelay}
              onReadDish={handleReadDish}
              onTareDish={handleTareDish}
              lowStockCount={lowStockCount}
              queuedForTomorrowCount={queuedForTomorrowCount}
            />

            <DeviceManager
              transport={transport}
              telemetry={telemetry}
              customBleServiceUuid={customBleServiceUuid}
              onChangeCustomBleServiceUuid={setCustomBleServiceUuid}
              timezone={timezone}
              onChangeTimezone={handleTimezoneChange}
              use24Hour={use24Hour}
              onToggle24Hour={() => setUse24Hour((prev) => !prev)}
              autoSyncClock={autoSyncClock}
              onToggleAutoSyncClock={() => setAutoSyncClock((prev) => !prev)}
              clockSnapshot={clockSnapshot}
              packetLogs={packetLogs}
              onClearLogs={() => setPacketLogs([])}
              onConnectBle={handleConnectBle}
              onConnectSerial={handleConnectSerial}
              onDisconnect={handleDisconnect}
              onSyncClock={() => syncClockToDevice(timezone)}
              onSyncPlans={handleSyncPlans}
              onPingDevice={handlePingDevice}
              onSendRawCommand={handleSendRawCommand}
              connectionError={connectionError}
              isConnecting={isConnecting}
              isSyncingClock={isSyncingClock}
            />

            <DispenserControl
              slots={slots}
              delays={delays}
              transport={transport}
              pendingDropSlot={telemetry.pendingDropSlot}
              clockSnapshot={clockSnapshot}
              use24Hour={use24Hour}
              onDropPill={(slotNum) => handleDropPill(slotNum, 'manual')}
              onUpdateSlot={handleUpdateSlot}
            />

            <CaregiverDashboard
              logs={adherenceLogs}
              slots={slots}
              clockSnapshot={clockSnapshot}
              use24Hour={use24Hour}
              onMarkStatus={handleMarkStatus}
              onClearAdherenceLogs={() => setAdherenceLogs([])}
            />
          </>
        )}

        {activeTab === 'dispenser' && (
          <DispenserControl
            slots={slots}
            delays={delays}
            transport={transport}
            pendingDropSlot={telemetry.pendingDropSlot}
            clockSnapshot={clockSnapshot}
            use24Hour={use24Hour}
            onDropPill={(slotNum) => handleDropPill(slotNum, 'manual')}
            onUpdateSlot={handleUpdateSlot}
          />
        )}

        {activeTab === 'caregiver' && (
          <CaregiverDashboard
            logs={adherenceLogs}
            slots={slots}
            clockSnapshot={clockSnapshot}
            use24Hour={use24Hour}
            onMarkStatus={handleMarkStatus}
            onClearAdherenceLogs={() => setAdherenceLogs([])}
          />
        )}
      </main>
    </div>
  );
}

export default App;
