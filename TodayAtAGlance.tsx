import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Play,
  RefreshCw,
  Scale,
  XCircle,
} from 'lucide-react';
import type {
  DishSensorState,
  TimezoneSnapshot,
  TodayDoseItem,
  TransportKind,
} from '../types/dispenser';
import { formatTimeDisplay } from '../utils/timezone';

interface TodayAtAGlanceProps {
  todayDoses: TodayDoseItem[];
  dishSensor: DishSensorState;
  dishRefreshMs: number;
  onChangeDishRefreshMs: (ms: number) => void;
  transport: TransportKind;
  pendingDropSlot: number | null;
  clockSnapshot: TimezoneSnapshot;
  use24Hour: boolean;
  onDropDose: (slotNum: number, origTime: string) => void;
  onDelayDose: (slotNum: number, originalTime: string, minutes: number) => void;
  onCancelDelay: (slotNum: number, originalTime: string) => void;
  onReadDish: () => void;
  onTareDish: () => void;
  lowStockCount: number;
  queuedForTomorrowCount: number;
}

export function TodayAtAGlance({
  todayDoses,
  dishSensor,
  dishRefreshMs,
  onChangeDishRefreshMs,
  transport,
  pendingDropSlot,
  clockSnapshot,
  use24Hour,
  onDropDose,
  onDelayDose,
  onCancelDelay,
  onReadDish,
  onTareDish,
  lowStockCount,
  queuedForTomorrowCount,
}: TodayAtAGlanceProps) {
  const isConnected = transport !== 'disconnected';
  const dispensedCount = todayDoses.filter((d) => d.state === 'dispensed').length;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sky-700">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            Live Schedule &amp; HX711 Dish Sensor
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
            Today at a Glance
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {clockSnapshot.dateFormatted} &middot; {clockSnapshot.ianaTimezone} ({clockSnapshot.offsetLabel})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-900 text-white px-4 py-2.5 rounded-xl font-mono text-lg font-semibold tabular-nums">
            {use24Hour ? clockSnapshot.time24 : clockSnapshot.time12}
          </div>
          <div className="bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl text-xs">
            <div className="text-slate-500">Completed Today</div>
            <div className="text-sm font-bold text-slate-900 tabular-nums">
              {dispensedCount} / {todayDoses.length} doses
            </div>
          </div>
        </div>
      </div>

      {/* Status & HX711 Load Cell Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
              HX711 Dish Scale
            </div>
            <div className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
              {dishSensor.weightGrams !== null
                ? `${dishSensor.weightGrams.toFixed(2)} g`
                : '— g'}
            </div>
            <div className="text-xs mt-0.5">
              {dishSensor.status === 'pill_detected' && (
                <span className="text-emerald-700 font-semibold">Pill detected in dish</span>
              )}
              {dishSensor.status === 'awaiting_drop' && (
                <span className="text-amber-700 font-semibold">Awaiting pill pickup</span>
              )}
              {dishSensor.status === 'empty' && (
                <span className="text-slate-500">Dish empty</span>
              )}
              {dishSensor.status === 'disconnected' && (
                <span className="text-slate-400">Connect device to stream weight</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onReadDish}
              disabled={!isConnected}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Read
            </button>
            <button
              type="button"
              onClick={onTareDish}
              disabled={transport !== 'serial'}
              title="Tare is supported over USB Serial"
              className="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg disabled:opacity-40 cursor-pointer"
            >
              Tare
            </button>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Scale Auto-Poll</span>
            <select
              value={dishRefreshMs}
              onChange={(e) => onChangeDishRefreshMs(Number(e.target.value))}
              aria-label="Scale refresh interval"
              className="text-xs font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-700"
            >
              <option value={0}>Manual only</option>
              <option value={1000}>Every 1s</option>
              <option value={2000}>Every 2s</option>
              <option value={5000}>Every 5s</option>
            </select>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {dishSensor.lastUpdatedAt
              ? `Updated ${new Date(dishSensor.lastUpdatedAt).toLocaleTimeString()}`
              : 'Waiting for first scale reading'}
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500">Compartment Alerts</span>
            {lowStockCount > 0 ? (
              <span className="inline-flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                {lowStockCount} low/empty
              </span>
            ) : (
              <span className="font-semibold text-emerald-700">Stock OK</span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <span>
              {queuedForTomorrowCount > 0
                ? `${queuedForTomorrowCount} compartment(s) queued to start tomorrow`
                : 'All enabled schedules active today'}
            </span>
          </div>
        </div>
      </div>

      {/* Today's Dose Queue */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          Scheduled Doses ({todayDoses.length})
        </h2>

        {todayDoses.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500">
            No active doses scheduled for today. Enable a compartment in{' '}
            <span className="font-semibold text-slate-700">4 Servos</span> below and set its start date to today or earlier.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {todayDoses.map((dose) => {
              const isDropping = pendingDropSlot === dose.slot;
              return (
                <div
                  key={dose.key}
                  className="p-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 font-mono text-xs font-bold shrink-0">
                      S{dose.slot}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">
                          {dose.medicationName}
                        </span>
                        <span className="text-xs text-slate-500">
                          ({dose.dosagePills} {dose.dosagePills === 1 ? 'pill' : 'pills'})
                        </span>
                        {dose.state === 'dispensed' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                            Dispensed
                          </span>
                        )}
                        {dose.state === 'due' && (
                          <span className="text-xs font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
                            Due Now
                          </span>
                        )}
                        {dose.state === 'missed' && (
                          <span className="text-xs font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                            Overdue
                          </span>
                        )}
                        {dose.state === 'delayed' && (
                          <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                            Delayed +{dose.delayMinutes}m
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {formatTimeDisplay(dose.effectiveTime, use24Hour)}
                        {dose.delayMinutes > 0 && (
                          <span className="ml-2 line-through text-slate-400">
                            {formatTimeDisplay(dose.originalTime, use24Hour)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {dose.state !== 'dispensed' && (
                      <>
                        {dose.delayMinutes > 0 ? (
                          <button
                            type="button"
                            onClick={() => onCancelDelay(dose.slot, dose.originalTime)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                            Reset Delay
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDelayDose(dose.slot, dose.originalTime, 15)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                          >
                            +15m
                          </button>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => onDropDose(dose.slot, dose.originalTime)}
                      disabled={!isConnected || isDropping || dose.stockLevel === 'empty'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg disabled:opacity-40 cursor-pointer"
                    >
                      <Play className="w-3 h-3" aria-hidden="true" />
                      {isDropping ? 'Dispensing...' : 'Dispense Now'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
