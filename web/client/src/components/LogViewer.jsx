import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export default function LogViewer({ runId, active }) {
  const ref = useRef(null);
  const { data } = useQuery({
    queryKey: ["run-logs", runId],
    queryFn: () => api.getRunLogs(runId),
    refetchInterval: active ? 2000 : false,
    enabled: !!runId,
  });

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [data?.logs]);

  const logs = data?.logs || "";

  return (
    <pre
      ref={ref}
      className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap overflow-y-auto max-h-96 min-h-16"
    >
      {logs
        ? <span className="text-green-400">{logs}</span>
        : <span className="text-gray-600 italic">
            {active ? "Waiting for worker to pick up job..." : "No logs for this run."}
          </span>
      }
    </pre>
  );
}
