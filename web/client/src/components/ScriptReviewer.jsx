import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export default function ScriptReviewer({ run, agentId }) {
  const qc = useQueryClient();
  const scripts = run?.scripts_data?.pending || [];
  const [edited, setEdited] = useState(() => scripts.map((s) => ({ ...s })));

  const { mutate: approve, isPending } = useMutation({
    mutationFn: () => api.approveScripts(run.id, edited),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runs", agentId] }),
  });

  if (scripts.length === 0) return null;

  return (
    <div className="space-y-5">
      <h3 className="text-white font-medium">Review Scripts ({scripts.length})</h3>
      {edited.map((script, i) => (
        <div key={i} className="bg-gray-950 border border-gray-800 rounded-xl p-5 space-y-3">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Script {i + 1}</p>
          {["hook", "bridge", "insight", "impact"].map((field) => (
            <div key={field}>
              <label className="text-gray-500 text-xs uppercase">{field}</label>
              <textarea
                value={script[field] || ""}
                onChange={(e) => {
                  const next = [...edited];
                  next[i] = { ...next[i], [field]: e.target.value };
                  setEdited(next);
                }}
                rows={field === "insight" ? 3 : 2}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}
        </div>
      ))}
      <button
        onClick={() => approve()}
        disabled={isPending}
        className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        {isPending ? "Approving..." : "Approve All & Generate Videos"}
      </button>
    </div>
  );
}
