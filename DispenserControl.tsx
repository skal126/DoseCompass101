import { useState } from 'react';
import { Pill, Play, Plus, Trash2 } from 'lucide-react';
import type {
  CompartmentSlot,
  DoseDelay,
  StockLevel,
  TimezoneSnapshot,
  TransportKind,
} from '../types/dispenser';
import { formatTimeDisplay } from '../utils/timezone';

interface DispenserControlProps {
  slots: CompartmentSlot[];
  delays: DoseDelay[];
  transport: TransportKind;
  pendingDropSlot: number | null;
  clockSnapshot: TimezoneSnapshot;
  use24Hour: boolean;
  onDropPill: (slotNum: number) => void;
  onUpdateSlot: (updated: CompartmentSlot) => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DispenserControl({
  slots,
  transport,
  pendingDropSlot,
  clockSnapshot,
  use24Hour,
  onDropPill,
  onUpdateSlot,
}: DispenserControlProps) {
  const [newTimeBySlot, setNewTimeBySlot] = useState<Record<number, string>>({});
  const isConnected = transport !== 'disconnected';

  const handleAddTime = (slot: CompartmentSlot) => {
    const candidate = newTimeBySlot[slot.slot] || '09:00';
    if (slot.dispenseTimes.includes(candidate) || slot.dispenseTimes.length >= 8) return;
    const nextTimes = [...slot.dispenseTimes, candidate].sort();
    onUpdateSlot({ ...slot, dispenseTimes: nextTimes });
  };

  const handleRemoveTime = (slot: CompartmentSlot, timeToRemove: string) => {
    if (slot.dispenseTimes.length <= 1) return;
    onUpdateSlot({
      ...slot,
      dispenseTimes: slot.dispenseTimes.filter((t) => t !== timeToRemove),
    });
  };

  const handleToggleDay = (slot: CompartmentSlot, dayIndex: number) => {
    const nextDays = slot.days.map((val, idx) => (idx === dayIndex ? !val : val));
    if (!nextDays.some(Boolean)) return;
    onUpdateSlot({ ...slot, days: nextDays });
  };

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
      <div className="border-b border-slate-100 pb-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sky-700">
          <Pill className="w-3.5 h-3.5" aria-hidden="true" />
          4-Servo ESP32 Hardware Compartments
        </span>
        <h2 className="text-xl font-extrabold text-slate-900 mt-1">
          Compartment Schedules &amp; Manual Test Drop
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {slots.map((slot) => {
          const isDropping = pendingDropSlot === slot.slot;
          return (
            <div
              key={slot.slot}
              className="border border-slate-200 rounded-2xl p-5 bg-slate-50/60 space-y-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-mono text-xs font-bold">
                    Servo {slot.slot - 1} &middot; Slot {slot.slot}
                  </span>
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={(e) =>
                        onUpdateSlot({ ...slot, enabled: e.target.checked })
                      }
                      className="rounded border-slate-300"
                    />
                    Schedule Enabled
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => onDropPill(slot.slot)}
                  disabled={!isConnected || isDropping || slot.stockLevel === 'empty'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg disabled:opacity-40 cursor-pointer"
                >
                  <Play className="w-3 h-3" aria-hidden="true" />
                  {isDropping ? 'Dropping...' : 'Test Drop'}
                </button>
              </div>

              {/* Medication & Pills */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="sm:col-span-2">
                  <label className="block text-slate-500 font-medium mb-1">
                    Medication Name
                  </label>
                  <input
                    type="text"
                    value={slot.medicationName}
                    onChange={(e) =>
                      onUpdateSlot({ ...slot, medicationName: e.target.value })
                    }
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-medium mb-1">
                    Pills / Dose
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={slot.dosagePills}
                    onChange={(e) =>
                      onUpdateSlot({
                        ...slot,
                        dosagePills: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-slate-900"
                  />
                </div>
              </div>

              {/* Start Date, Course Days & Stock */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-500 font-medium mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={slot.startDateKey || clockSnapshot.dateKey}
                    onChange={(e) =>
                      onUpdateSlot({ ...slot, startDateKey: e.target.value })
                    }
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-medium mb-1">
                    Course (Days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={slot.courseDays}
                    onChange={(e) =>
                      onUpdateSlot({
                        ...slot,
                        courseDays: Math.min(365, Math.max(1, Number(e.target.value) || 1)),
                      })
                    }
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-medium mb-1">
                    Stock Level
                  </label>
                  <select
                    value={slot.stockLevel}
                    onChange={(e) =>
                      onUpdateSlot({
                        ...slot,
                        stockLevel: e.target.value as StockLevel,
                      })
                    }
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 font-semibold text-slate-800"
                  >
                    <option value="full">Full</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="empty">Empty</option>
                  </select>
                </div>
              </div>

              {/* Days of Week */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-slate-500">
                  Active Days
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_LABELS.map((label, idx) => {
                    const active = slot.days[idx];
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleToggleDay(slot, idx)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                          active
                            ? 'bg-sky-700 text-white border-sky-700'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dispense Times */}
              <div className="space-y-2">
                <span className="block text-xs font-medium text-slate-500">
                  Dispense Times
                </span>
                <div className="flex flex-wrap gap-2">
                  {slot.dispenseTimes.map((time) => (
                    <span
                      key={time}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-mono text-xs font-semibold text-slate-800"
                    >
                      {formatTimeDisplay(time, use24Hour)}
                      {slot.dispenseTimes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTime(slot, time)}
                          aria-label={`Remove ${time}`}
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>

                {slot.dispenseTimes.length < 8 && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="time"
                      value={newTimeBySlot[slot.slot] || '09:00'}
                      onChange={(e) =>
                        setNewTimeBySlot((prev) => ({
                          ...prev,
                          [slot.slot]: e.target.value,
                        }))
                      }
                      className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 font-mono text-xs text-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddTime(slot)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded-lg cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      Add Time
                    </button>
                  </div>
                )}
              </div>

              {slot.lastError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  {slot.lastError}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
