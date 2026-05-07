import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

// Convert AEST time (HH:MM, day) to UTC cron
function aestToUtcCron(timeStr, dayStr) {
  const [hh, mm] = timeStr.split(":").map(Number);
  // AEST = UTC+10, AEDT = UTC+11 (simplified: always use UTC+10)
  let utcH = (hh - 10 + 24) % 24;
  const dayMap = { "*": "*", "mon": "1", "tue": "2", "wed": "3", "thu": "4", "fri": "5", "sat": "6", "sun": "0" };
  const dow = dayMap[dayStr] || "*";
  return `${mm} ${utcH} * * ${dow}`;
}

function cronToAest(cron) {
  if (!cron) return cron;
  const parts = cron.split(" ");
  if (parts.length < 5) return cron;
  const [mm, utcH] = parts;
  const aestH = (parseInt(utcH, 10) + 10) % 24;
  const pad = (n) => String(n).padStart(2, "0");
  const dowNames = { "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat", "*": "Daily" };
  const dow = dowNames[parts[4]] || parts[4];
  return `${pad(aestH)}:${mm.padStart(2, "0")} AEST ${dow}`;
}

export default function ScheduleManager({ agentId }) {
  const qc = useQueryClient();
  const [time, setTime] = useState("06:00");
  const [day, setDay] = useState("*");
  const [mode, setMode] = useState("video");
  const [label, setLabel] = useState("");

  const { data: schedules = [] } = useQuery({
    queryKey: ["schedules", agentId],
    queryFn: () => api.getSchedules(agentId),
  });

  const { mutate: create, isPending } = useMutation({
    mutationFn: () => api.createSchedule(agentId, {
      run_mode: mode,
      cron_utc: aestToUtcCron(time, day),
      label: label || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules", agentId] });
      setLabel("");
    },
  });

  const { mutate: toggle } = useMutation({
    mutationFn: ({ id, is_active }) => api.updateSchedule(agentId, id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", agentId] }),
  });

  const { mutate: remove } = useMutation({
    mutationFn: (id) => api.deleteSchedule(agentId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", agentId] }),
  });

  return (
    <div className="space-y-5">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h3 className="text-white font-medium text-sm">Add Schedule</h3>
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="text-gray-500 text-xs block mb-1">Time (AEST)</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1">Day</label>
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="*">Daily</option>
              <option value="mon">Monday</option>
              <option value="tue">Tuesday</option>
              <option value="wed">Wednesday</option>
              <option value="thu">Thursday</option>
              <option value="fri">Friday</option>
              <option value="sat">Saturday</option>
              <option value="sun">Sunday</option>
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="video">Video</option>
              <option value="ingest">Ingest</option>
            </select>
          </div>
          <div className="flex-1 min-w-32">
            <label className="text-gray-500 text-xs block mb-1">Label (optional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Morning run"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        <button
          onClick={() => create()}
          disabled={isPending}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
        >
          Add Schedule
        </button>
      </div>

      <div className="space-y-2">
        {schedules.map((s) => (
          <div key={s.id} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <div>
              <span className="text-white text-sm">{s.label || cronToAest(s.cron_utc)}</span>
              {s.label && <span className="text-gray-500 text-xs ml-2">{cronToAest(s.cron_utc)}</span>}
              <span className={`ml-2 text-xs ${s.run_mode === "ingest" ? "text-blue-400" : "text-green-400"}`}>
                {s.run_mode}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => toggle({ id: s.id, is_active: !s.is_active })}
                className={`text-xs px-2 py-1 rounded ${s.is_active ? "bg-green-900 text-green-400" : "bg-gray-800 text-gray-500"}`}
              >
                {s.is_active ? "Active" : "Paused"}
              </button>
              <button onClick={() => remove(s.id)} className="text-gray-600 hover:text-red-400 text-xs transition-colors">
                Delete
              </button>
            </div>
          </div>
        ))}
        {schedules.length === 0 && <p className="text-gray-600 text-sm">No schedules yet.</p>}
      </div>
    </div>
  );
}
