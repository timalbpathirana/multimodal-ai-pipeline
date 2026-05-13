import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";


function TrashIcon({ color }) {
  return (
    <svg
      className="w-4 h-4 relative z-10 transition-colors"
      fill="none"
      viewBox="0 0 24 24"
      stroke={color || "currentColor"}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

const HOLD_MS = 1500;
const CIRC = 2 * Math.PI * 13; // radius 13 on a 32×32 SVG

function HoldToDelete({ onDelete, disabled }) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const onDeleteRef = useRef(onDelete);
  const tickRef = useRef(null);

  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

  // Cleanup on unmount — prevents state update on unmounted component
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const cancel = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    startRef.current = null;
    setProgress(0);
  }, []);

  const tick = useCallback(() => {
    if (!startRef.current) return;
    const p = Math.min((Date.now() - startRef.current) / HOLD_MS, 1);
    setProgress(p);
    if (p < 1) {
      rafRef.current = requestAnimationFrame(tickRef.current);
    } else {
      rafRef.current = null;
      startRef.current = null;
      setProgress(0);
      if (window.confirm("Delete this agent? This cannot be undone.")) {
        onDeleteRef.current();
      }
    }
  }, []);
  tickRef.current = tick;

  const startHold = useCallback((e) => {
    e.preventDefault();
    if (disabled || startRef.current) return;
    startRef.current = Date.now();
    rafRef.current = requestAnimationFrame(tickRef.current);
  }, [disabled]);

  const iconColor = progress > 0
    ? `rgba(228, 83, 40, ${0.4 + progress * 0.6})`
    : undefined;

  return (
    <button
      type="button"
      onMouseDown={startHold}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={startHold}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
      disabled={disabled}
      aria-label="Hold to delete agent"
      className="relative flex items-center justify-center w-7 h-7 rounded-full select-none disabled:opacity-50 text-gray-600 hover:text-gray-400 transition-colors"
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
    >
      {/* Ring progress — only rendered when holding */}
      {progress > 0 && (
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          className="absolute pointer-events-none"
          style={{ transform: "rotate(-90deg)" }}
          aria-hidden="true"
        >
          {/* Track */}
          <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(228,83,40,0.15)" strokeWidth="2" />
          {/* Fill arc */}
          <circle
            cx="16"
            cy="16"
            r="13"
            fill="none"
            stroke="#e45328"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - progress)}
          />
        </svg>
      )}
      <TrashIcon color={iconColor} />
    </button>
  );
}

function PencilIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.28 6.28 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.16 8.16 0 004.77 1.52V6.82a4.85 4.85 0 01-1-.13z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function ServiceBadge({ icon, label, connected }) {
  return (
    <span
      title={connected ? `${label} connected` : `${label} not connected`}
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md font-medium transition-colors ${
        connected
          ? "bg-gray-700 text-white"
          : "bg-gray-800/60 text-gray-600"
      }`}
    >
      {icon}
      {label}
    </span>
  );
}

function AgentCard({ agent }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [niche, setNiche] = useState(agent.niche);

  const { mutate: toggleActive, isPending: isToggling } = useMutation({
    mutationFn: () => api.updateAgent(agent.id, { is_active: !agent.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });

  const { mutate: deleteAgent, isPending: isDeleting } = useMutation({
    mutationFn: () => api.deleteAgent(agent.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });

  const handleDelete = useCallback(() => deleteAgent(), [deleteAgent]);

  const { mutate: saveEdit, isPending: isSaving } = useMutation({
    mutationFn: () => api.updateAgent(agent.id, { name: name.trim(), niche: niche.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      setEditing(false);
    },
  });

  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleActive();
  };


  const handleEditOpen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setName(agent.name);
    setNiche(agent.niche);
    setEditing(true);
  };

  const handleEditCancel = () => {
    setEditing(false);
    setName(agent.name);
    setNiche(agent.niche);
  };

  const activeBadge = (
    <span
      className={`inline-flex items-center text-xs px-2 py-0.5 rounded-md font-medium ${
        agent.is_active
          ? "bg-green-900/30 text-green-400"
          : "bg-gray-800 text-gray-500"
      }`}
    >
      {agent.is_active ? "Active" : "Disabled"}
    </span>
  );

  if (editing) {
    return (
      <div className="bg-gray-900 border border-indigo-700/50 rounded-xl p-5 space-y-3">
        <p className="text-white text-sm font-medium">Edit Agent</p>
        <div>
          <label className="text-gray-500 text-xs mb-1 block">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="text-gray-500 text-xs mb-1 block">Niche / Description</label>
          <input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="Niche slug"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => saveEdit()}
            disabled={isSaving || !name.trim() || !niche.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={handleEditCancel}
            className="text-gray-400 hover:text-white text-sm px-4 py-1.5 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-5 transition-colors">
      <div className="flex items-center justify-between gap-4">
        {/* Left: name + active badge + niche */}
        <Link to={`/agents/${agent.id}`} className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-white font-medium truncate">{agent.name}</h2>
            <button
              type="button"
              onClick={handleToggle}
              disabled={isToggling}
              aria-label={agent.is_active ? "Disable agent" : "Enable agent"}
              className="shrink-0 focus:outline-none"
            >
              {isToggling ? (
                <span className="text-xs text-gray-500">...</span>
              ) : activeBadge}
            </button>
          </div>
          <p className="text-gray-500 text-sm">{agent.niche}</p>
        </Link>

        {/* Right: service badges + actions */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <ServiceBadge icon={<TikTokIcon />} label="TikTok" connected={agent.has_tiktok} />
            <ServiceBadge icon={<TelegramIcon />} label="Telegram" connected={agent.has_telegram} />
          </div>
          <div className="flex items-center gap-1 border-l border-gray-800 pl-3">
            <button
              type="button"
              onClick={handleEditOpen}
              aria-label="Edit agent"
              className="text-gray-600 hover:text-white transition-colors rounded p-1"
            >
              <PencilIcon />
            </button>
            <HoldToDelete onDelete={handleDelete} disabled={isDeleting} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AgentListPage() {
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const { mutate: createAgent, isPending } = useMutation({
    mutationFn: () => api.createAgent({ name, niche }),
    onSuccess: (agent) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      navigate(`/agents/${agent.id}`);
    },
  });

  const handleCancel = () => {
    setShowNew(false);
    setName("");
    setNiche("");
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Agents</h1>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
        >
          + New Agent
        </button>
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
              type="button"
              onClick={() => createAgent()}
              disabled={isPending || !name || !niche}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
            >
              Create
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="text-gray-400 hover:text-white text-sm px-4 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}

      <div className="space-y-3">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
        {!isLoading && agents.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-600 text-sm">No agents yet.</p>
            <p className="text-gray-700 text-xs mt-1">Click + New Agent to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
