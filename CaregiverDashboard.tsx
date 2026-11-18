import { CheckCircle2, ClipboardList, Trash2, XCircle } from 'lucide-react';
import type {
  AdherenceLogEntry,
  CompartmentSlot,
  TimezoneSnapshot,
} from '../types/dispenser';
import { formatTimeDisplay } from '../utils/timezone';

interface CaregiverDashboardProps {
  logs: AdherenceLogEntry[];
  slots: CompartmentSlot[];
  clockSnapshot: TimezoneSnapshot;
  use24Hour: boolean;
  onMarkStatus: (entryId: string, status: 'taken' | 'missed') => void;
  onClearAdherenceLogs: () => void;
}

export function CaregiverDashboard({
  logs,
  use24Hour,
  onMarkStatus,
  onClearAdherenceLogs,
}: CaregiverDashboardProps) {
  const takenOrDispensed = logs.filter(
    (l) => l.status === 'taken' || l.status === 'dispensed',
  ).length;
  const adherenceRate =
    logs.length > 0 ? Math.round((takenOrDispensed / logs.length) * 100) : 100;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sky-700">
            <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
            Caregiver Adherence Audit
          </span>
          <h2 className="text-xl font-extrabold text-slate-900 mt-1">
            Dispense &amp; Intake History
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl text-xs">
            <span className="text-slate-500">Adherence Rate: </span>
            <span className="font-bold text-slate-900">{adherenceRate}%</span>
          </div>
          {logs.length > 0 && (
            <button
              type="button"
              onClick={onClearAdherenceLogs}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Clear Log
            </button>
          )}
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500">
          No dispense events recorded yet. Trigger a manual test drop or run a scheduled dose to populate the caregiver log.
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase">
                <th className="py-3 px-4 font-bold">Time</th>
                <th className="py-3 px-4 font-bold">Slot / Medication</th>
                <th className="py-3 px-4 font-bold">Scheduled</th>
                <th className="py-3 px-4 font-bold">Source</th>
                <th className="py-3 px-4 font-bold">Status</th>
                <th className="py-3 px-4 font-bold text-right">Caregiver Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    S{entry.slot} &middot; {entry.medicationName} ({entry.dosagePills})
                    {entry.note && (
                      <div className="font-normal text-slate-500 mt-0.5">{entry.note}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                    {formatTimeDisplay(entry.scheduledTime, use24Hour)}
                  </td>
                  <td className="py-3 px-4 uppercase font-mono text-slate-600">
                    {entry.source}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full font-semibold ${
                        entry.status === 'taken' || entry.status === 'dispensed'
                          ? 'bg-emerald-50 text-emerald-700'
                          : entry.status === 'missed'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onMarkStatus(entry.id, 'taken')}
                        className="inline-flex items-center gap-1 px-2 py-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md font-semibold cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        Taken
                      </button>
                      <button
                        type="button"
                        onClick={() => onMarkStatus(entry.id, 'missed')}
                        className="inline-flex items-center gap-1 px-2 py-1 text-red-700 bg-red-50 hover:bg-red-100 rounded-md font-semibold cursor-pointer"
                      >
                        <XCircle className="w-3 h-3" aria-hidden="true" />
                        Missed
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
