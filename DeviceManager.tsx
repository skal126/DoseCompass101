import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Bluetooth,
  Clock,
  Cpu,
  Radio,
  RefreshCw,
  Send,
  Trash2,
  Usb,
} from 'lucide-react';
import type {
  HardwareTelemetry,
  PacketLogEntry,
  TimezoneSnapshot,
  TransportKind,
} from '../types/dispenser';
import { COMMON_TIMEZONES } from '../utils/timezone';

interface DeviceManagerProps {
  transport: TransportKind;
  telemetry: HardwareTelemetry;
  customBleServiceUuid: string;
  onChangeCustomBleServiceUuid: (uuid: string) => void;
  timezone: string;
  onChangeTimezone: (tz: string) => void;
  use24Hour: boolean;
  onToggle24Hour: () => void;
  autoSyncClock: boolean;
  onToggleAutoSyncClock: () => void;
  clockSnapshot: TimezoneSnapshot;
  packetLogs: PacketLogEntry[];
  onClearLogs: () => void;
  onConnectBle: () => void;
  onConnectSerial: () => void;
  onDisconnect: () => void;
  onSyncClock: () => void;
  onSyncPlans: () => void;
  onPingDevice: () => void;
  onSendRawCommand: (cmd: string) => void;
  connectionError: string | null;
  isConnecting: boolean;
  isSyncingClock: boolean;
}

export function DeviceManager({
  transport,
  telemetry,
  customBleServiceUuid,
  onChangeCustomBleServiceUuid,
  timezone,
  onChangeTimezone,
  use24Hour,
  onToggle24Hour,
  autoSyncClock,
  onToggleAutoSyncClock,
  packetLogs,
  onClearLogs,
  onConnectBle,
  onConnectSerial,
  onDisconnect,
  onSyncClock,
  onSyncPlans,
  onPingDevice,
  onSendRawCommand,
  connectionError,
  isConnecting,
  isSyncingClock,
}: DeviceManagerProps) {
  const [rawCmd, setRawCmd] = useState('');
  const isConnected = transport !== 'disconnected';

  const timezoneOptions = COMMON_TIMEZONES.includes(timezone)
    ? COMMON_TIMEZONES
    : [timezone, ...COMMON_TIMEZONES];

  const handleSubmitRaw = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = rawCmd.trim();
    if (!trimmed) return;
    onSendRawCommand(trimmed);
    setRawCmd('');
  };

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sky-700">
            <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
            ESP32 Hardware Link &amp; Clock Sync
          </span>
          <h2 className="text-xl font-extrabold text-slate-900 mt-1">
            Device &amp; Protocol Console
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isConnected ? (
            <>
              <button
                type="button"
                onClick={onConnectBle}
                disabled={isConnecting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg disabled:opacity-50 cursor-pointer"
              >
                <Bluetooth className="w-3.5 h-3.5" aria-hidden="true" />
                Connect BLE
              </button>
              <button
                type="button"
                onClick={onConnectSerial}
                disabled={isConnecting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg disabled:opacity-50 cursor-pointer"
              >
                <Usb className="w-3.5 h-3.5" aria-hidden="true" />
                Connect USB Serial
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onSyncClock}
                disabled={transport !== 'serial' || isSyncingClock}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                {isSyncingClock ? 'Syncing...' : 'Sync Clock'}
              </button>
              <button
                type="button"
                onClick={onSyncPlans}
                disabled={transport !== 'serial'}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-40 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                Sync 4 Plans
              </button>
              <button
                type="button"
                onClick={onPingDevice}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                Query Status
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg cursor-pointer"
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>

      {connectionError && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>{connectionError}</div>
        </div>
      )}

      {/* Telemetry & Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="font-bold text-slate-700 uppercase tracking-wide">Link Status</div>
          <div className="flex justify-between">
            <span className="text-slate-500">Transport</span>
            <span className="font-semibold text-slate-900 uppercase">{transport}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Device</span>
            <span className="font-semibold text-slate-900">
              {telemetry.deviceName ?? 'Not paired'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Last ACK RTT</span>
            <span className="font-mono text-slate-900">
              {telemetry.lastRttMs !== null ? `${telemetry.lastRttMs} ms` : '—'}
            </span>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
          <div className="font-bold text-slate-700 uppercase tracking-wide">
            Timezone &amp; Clock
          </div>
          <div>
            <label htmlFor="tz-select" className="block text-slate-500 mb-1">
              Dispenser Timezone
            </label>
            <select
              id="tz-select"
              value={timezone}
              onChange={(e) => onChangeTimezone(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 font-medium"
            >
              {timezoneOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={use24Hour}
                onChange={onToggle24Hour}
                className="rounded border-slate-300"
              />
              24-hour clock
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSyncClock}
                onChange={onToggleAutoSyncClock}
                className="rounded border-slate-300"
              />
              Auto-sync on USB
            </label>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="font-bold text-slate-700 uppercase tracking-wide">
            Optional Custom BLE UUID
          </div>
          <input
            type="text"
            value={customBleServiceUuid}
            onChange={(e) => onChangeCustomBleServiceUuid(e.target.value)}
            placeholder="e.g. 4fafc201-1fb5-459e-8fcc-c5c9c331914b"
            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-xs text-slate-800"
          />
          <p className="text-slate-500 leading-relaxed">
            Leave blank for standard Nordic UART / DoseCompass GATT services.
          </p>
        </div>
      </div>

      {/* Packet Console */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-700">
            Hardware Packet Log ({packetLogs.length})
          </span>
          <button
            type="button"
            onClick={onClearLogs}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            Clear
          </button>
        </div>

        <div className="bg-slate-900 text-slate-100 rounded-xl p-3.5 font-mono text-xs h-44 overflow-y-auto space-y-1">
          {packetLogs.length === 0 ? (
            <div className="text-slate-500">
              No packets yet. Pair via Bluetooth LE or USB Serial (115200 baud) to inspect live traffic.
            </div>
          ) : (
            packetLogs.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 leading-relaxed">
                <span className="text-slate-500 shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className={`uppercase font-bold shrink-0 ${
                    entry.direction === 'tx'
                      ? 'text-sky-400'
                      : entry.direction === 'rx'
                        ? 'text-emerald-400'
                        : entry.direction === 'error'
                          ? 'text-red-400'
                          : 'text-amber-300'
                  }`}
                >
                  [{entry.direction}]
                </span>
                <span className="break-all">{entry.message}</span>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSubmitRaw} className="flex gap-2">
          <input
            type="text"
            value={rawCmd}
            onChange={(e) => setRawCmd(e.target.value)}
            disabled={!isConnected}
            placeholder="Send raw ESP32 command (e.g. P?, w, t, G 0)..."
            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-xs text-slate-900 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!isConnected || !rawCmd.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg disabled:opacity-40 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
