import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

const STATUS_COLOR = {
  done: "text-green-400",
  running: "text-yellow-400",
  queued: "text-blue-400",
  awaiting_review: "text-purple-400",
  failed: "text-red-400",
};

export default function AgentListPage() {
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: agents = [], isLoading } = useQuery({ queryKey: ["agents"], queryFn: api.getAgents });

  const { mutate: createAgent, isPending } = useMutation({
    mutationFn: () => api.createAgent({ name, niche }),
    onSuccess: (agent) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      navigate(`/agents/${agent.id}`);
    },
  });

  const { mutate: logout } = useMutation({
    mutationFn: api.logout,
    onSuccess: () => { qc.clear(); navigate("/login"); },
  });

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Agents</h1>
          <div className="flex gap-3">
            <Link to="/config" className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800">
              Global Config
            </Link>
            <button onClick={() => logout()} className="text-sm text-gray-400 hover:text-white transition-colors">
              Sign out
            </button>
            <button
              onClick={() => setShowNew(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
            >
              + New Agent
            </button>
          </div>
        </div>

        {showNew && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5 space-y-3">
            <h2 className="text-white font-medium">New Agent</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name (e.g. Melbourne Property)"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="Niche slug (e.g. melbourne_property)"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => createAgent()}
                disabled={isPending || !name || !niche}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
              >
                Create
              </button>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-white text-sm px-4 py-1.5">
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoading && <p className="text-gray-500">Loading...</p>}

        <div className="space-y-3">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              to={`/agents/${agent.id}`}
              className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-5 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-white font-medium">{agent.name}</h2>
                  <p className="text-gray-500 text-sm mt-0.5">{agent.niche}</p>
                </div>
                <div className="text-right">
                  {agent.last_run_status && (
                    <span className={`text-xs font-medium ${STATUS_COLOR[agent.last_run_status] || "text-gray-400"}`}>
                      {agent.last_run_status}
                    </span>
                  )}
                  {!agent.is_active && (
                    <span className="ml-2 text-xs text-gray-600">inactive</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
