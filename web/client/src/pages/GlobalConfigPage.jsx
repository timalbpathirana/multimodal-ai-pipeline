import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

const KEYS = [
  { key: "anthropic_api_key", label: "Anthropic API Key", placeholder: "sk-ant-..." },
  { key: "elevenlabs_api_key", label: "ElevenLabs API Key", placeholder: "" },
  { key: "pexels_api_key", label: "Pexels API Key", placeholder: "" },
  { key: "airtable_api_key", label: "Airtable API Key", placeholder: "pat..." },
  { key: "serper_api_key", label: "Serper API Key", placeholder: "" },
  { key: "trigger_secret_key", label: "Trigger Secret Key", placeholder: "" },
];

export default function GlobalConfigPage() {
  const qc = useQueryClient();
  const { data: config = {} } = useQuery({ queryKey: ["config"], queryFn: api.getConfig });
  const [form, setForm] = useState({});

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.saveConfig(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["config"] }); setForm({}); },
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/" className="text-gray-500 hover:text-white text-sm transition-colors">← Agents</Link>
          <span className="text-gray-700">/</span>
          <h1 className="text-xl font-bold text-white">Global Config</h1>
        </div>
        <p className="text-gray-500 text-sm mb-5">
          Default API keys applied to all agents. Per-agent overrides take priority.
          Current values shown masked — enter a new value to update.
        </p>
        <div className="space-y-4">
          {KEYS.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="text-gray-400 text-sm block mb-1">{label}</label>
              {config[key] && !form[key] && (
                <p className="text-gray-600 text-xs mb-1 font-mono">{config[key]}</p>
              )}
              <input
                type="password"
                value={form[key] || ""}
                onChange={(e) => set(key, e.target.value)}
                placeholder={config[key] ? "Enter new value to update" : placeholder}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => save()}
          disabled={isPending || Object.keys(form).length === 0}
          className="mt-5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg transition-colors"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
