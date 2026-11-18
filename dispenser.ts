export type TransportKind = 'disconnected' | 'ble' | 'serial' | 'mqtt';

export type StockLevel = 'full' | 'medium' | 'low' | 'empty';

export interface CompartmentSlot {
  slot: number;
  courseDays: number;
  medicationName: string;
  dosagePills: number;
  dispenseTimes: string[];
  days: boolean[];
  stockLevel: StockLevel;
  enabled: boolean;
  startDateKey?: string;
  lastDispensedAt: string | null;
  lastStatus: 'idle' | 'dispensing' | 'dispensed' | 'error';
  lastError?: string;
}

export interface DoseDelay {
  slot: number;
  originalTime: string;
  delayedToTime: string;
  delayMinutes: number;
  dateKey: string;
}

export interface AdherenceLogEntry {
  id: string;
  slot: number;
  medicationName: string;
  dosagePills: number;
  scheduledTime: string;
  timezone: string;
  status: 'dispensed' | 'taken' | 'missed' | 'error';
  source: 'manual' | 'schedule' | 'ble' | 'serial' | 'mqtt';
  timestamp: string;
  note?: string;
}

export interface PacketLogEntry {
  id: string;
  direction: 'tx' | 'rx' | 'info' | 'error';
  transport: TransportKind;
  message: string;
  timestamp: string;
}

export interface DishSensorState {
  weightGrams: number | null;
  status: 'disconnected' | 'empty' | 'awaiting_drop' | 'pill_detected';
  lastUpdatedAt: string | null;
  lastTaredAt: string | null;
}

export interface HardwareTelemetry {
  deviceName: string | null;
  linkDetail: string | null;
  writeMode: string | null;
  lastRttMs: number | null;
  lastClockSyncAt: string | null;
  lastClockSyncTz: string | null;
  pendingDropSlot: number | null;
}

export interface TodayDoseItem {
  key: string;
  slot: number;
  medicationName: string;
  dosagePills: number;
  originalTime: string;
  effectiveTime: string;
  delayMinutes: number;
  stockLevel: StockLevel;
  state: 'upcoming' | 'due' | 'dispensed' | 'missed' | 'delayed';
  minutesDelta: number;
}

export interface TimezoneSnapshot {
  ianaTimezone: string;
  offsetLabel: string;
  dateKey: string;
  dateFormatted: string;
  time24: string;
  time12: string;
  dayOfWeek: number;
  dayName: string;
  unixSeconds: number;
}
