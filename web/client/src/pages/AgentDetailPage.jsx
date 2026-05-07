import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import LogViewer from "../components/LogViewer";
import ScriptReviewer from "../components/ScriptReviewer";
import ScheduleManager from "../components/ScheduleManager";

const TABS = ["Settings", "Config", "Feeds", "Prompts", "Schedule", "Runs"];
const STATUS_COLOR = { done: "text-green-400", running: "text-yellow-400", queued: "text-blue-400", awaiting_review: "text-purple-400", failed: "text-red-400" };

// ── Reusable input components ─────────────────────────────────────────────────

function Field({ label, value, onChange, type = "text", placeholder, hint }) {
  return (
    <div>
      <label className="text-gray-400 text-sm block mb-1">{label}</label>
      {hint && <p className="text-gray-600 text-xs mb-1">{hint}</p>}
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
      />
    </div>
  );
}

function Toggle({ label, value, onChange, hint }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-gray-400 text-sm">{label}</span>
        {hint && <p className="text-gray-600 text-xs">{hint}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${value ? "bg-indigo-600" : "bg-gray-700"}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

function SaveButton({ onClick, isPending }) {
  return (
    <button
      onClick={onClick}
      disabled={isPending}
      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg transition-colors"
    >
      {isPending ? "Saving..." : "Save"}
    </button>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function SettingsTab({ agentId }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings", agentId], queryFn: () => api.getSettings(agentId) });
  const [form, setForm] = useState(null);
  const s = form || settings || {};
  const set = (k, v) => setForm((f) => ({ ...(f || s), [k]: v }));

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.saveSettings(agentId, s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", agentId] }); setForm(null); },
  });

  return (
    <div className="space-y-4">
      <Field label="ElevenLabs Voice ID" value={s.elevenlabs_voice_id} onChange={(v) => set("elevenlabs_voice_id", v)} placeholder="cjVigY5qzO86Huf0OWal" />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Number of Videos" value={s.number_of_videos} onChange={(v) => set("number_of_videos", parseInt(v) || 1)} type="number" />
        <Field label="Stories per Week" value={s.stories_per_week} onChange={(v) => set("stories_per_week", parseInt(v) || 28)} type="number" />
        <Field label="Ingest Lookback Days" value={s.ingest_lookback_days} onChange={(v) => set("ingest_lookback_days", parseInt(v) || 7)} type="number" />
        <div>
          <label className="text-gray-400 text-sm block mb-1">Pipeline Stop After</label>
          <select
            value={s.pipeline_stop_after || ""}
            onChange={(e) => set("pipeline_stop_after", e.target.value || null)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Full pipeline</option>
            <option value="ingest">Ingest only</option>
            <option value="script">Script only</option>
            <option value="voice">Voice only</option>
          </select>
        </div>
      </div>
      <div className="space-y-3 border border-gray-800 rounded-xl p-4">
        <Toggle label="Breaking News Mode" value={!!s.is_breaking_news} onChange={(v) => set("is_breaking_news", v)} hint="Fetches fresh RSS/YouTube content instead of Airtable stories" />
        <Toggle label="Human-in-the-Loop" value={!!s.human_in_the_loop} onChange={(v) => set("human_in_the_loop", v)} hint="Pauses after script generation for manual hook review" />
      </div>
      <SaveButton onClick={() => save()} isPending={isPending} />
    </div>
  );
}

function ConfigTab({ agentId }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings", agentId], queryFn: () => api.getSettings(agentId) });
  const [form, setForm] = useState(null);
  const s = form || settings || {};
  const set = (k, v) => setForm((f) => ({ ...(f || s), [k]: v }));

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.saveSettings(agentId, s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", agentId] }); setForm(null); },
  });

  return (
    <div className="space-y-4">
      <p className="text-gray-500 text-xs">Leave blank to use global config defaults.</p>
      <div className="border border-gray-800 rounded-xl p-4 space-y-4">
        <h3 className="text-gray-300 text-sm font-medium">Airtable</h3>
        <Field label="Base ID" value={s.airtable_base_id} onChange={(v) => set("airtable_base_id", v)} placeholder="appXXXXXXXXXXXXXX" />
        <Field label="Table Name" value={s.airtable_table} onChange={(v) => set("airtable_table", v)} placeholder="Stories" />
        <Field label="API Key (override)" value={s.airtable_api_key} onChange={(v) => set("airtable_api_key", v)} type="password" placeholder="pat..." />
      </div>
      <div className="border border-gray-800 rounded-xl p-4 space-y-4">
        <h3 className="text-gray-300 text-sm font-medium">API Keys (per-agent overrides)</h3>
        <Field label="Anthropic API Key" value={s.anthropic_api_key} onChange={(v) => set("anthropic_api_key", v)} type="password" placeholder="sk-ant-..." />
        <Field label="ElevenLabs API Key" value={s.elevenlabs_api_key} onChange={(v) => set("elevenlabs_api_key", v)} type="password" />
        <Field label="Pexels API Key" value={s.pexels_api_key} onChange={(v) => set("pexels_api_key", v)} type="password" />
        <Field label="Serper API Key" value={s.serper_api_key} onChange={(v) => set("serper_api_key", v)} type="password" />
      </div>
      <div className="border border-gray-800 rounded-xl p-4 space-y-4">
        <h3 className="text-gray-300 text-sm font-medium">TikTok</h3>
        <Field label="Access Token" value={s.tiktok_access_token} onChange={(v) => set("tiktok_access_token", v)} type="password" hint="Expires every 24h — paste fresh token when needed" />
        <Field label="Open ID" value={s.tiktok_open_id} onChange={(v) => set("tiktok_open_id", v)} />
        <div>
          <label className="text-gray-400 text-sm block mb-1">Post Visibility</label>
          <select
            value={s.tiktok_privacy_level || "DRAFT_FOR_DIRECT_POST"}
            onChange={(e) => set("tiktok_privacy_level", e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="DRAFT_FOR_DIRECT_POST">Draft (direct post)</option>
            <option value="PUBLIC_TO_EVERYONE">Public</option>
            <option value="SELF_ONLY">Private</option>
          </select>
        </div>
        <Toggle label="Auto-post to TikTok" value={!!s.auto_post_to_tiktok} onChange={(v) => set("auto_post_to_tiktok", v)} />
      </div>
      <SaveButton onClick={() => save()} isPending={isPending} />
    </div>
  );
}

function FeedsTab({ agentId }) {
  const qc = useQueryClient();
  const [rssUrl, setRssUrl] = useState(""); const [rssLabel, setRssLabel] = useState("");
  const [ytId, setYtId] = useState(""); const [ytLabel, setYtLabel] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const { data: rss = [] } = useQuery({ queryKey: ["rss", agentId], queryFn: () => api.getRssFeeds(agentId) });
  const { data: yt = [] } = useQuery({ queryKey: ["yt", agentId], queryFn: () => api.getYoutubeFeeds(agentId) });
  const { data: sq = [] } = useQuery({ queryKey: ["sq", agentId], queryFn: () => api.getSearchQueries(agentId) });

  const addRss = useMutation({ mutationFn: () => api.addRssFeed(agentId, rssUrl, rssLabel), onSuccess: () => { qc.invalidateQueries({ queryKey: ["rss", agentId] }); setRssUrl(""); setRssLabel(""); } });
  const delRss = useMutation({ mutationFn: (id) => api.deleteRssFeed(agentId, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["rss", agentId] }) });
  const addYt = useMutation({ mutationFn: () => api.addYoutubeFeed(agentId, ytId, ytLabel), onSuccess: () => { qc.invalidateQueries({ queryKey: ["yt", agentId] }); setYtId(""); setYtLabel(""); } });
  const delYt = useMutation({ mutationFn: (id) => api.deleteYoutubeFeed(agentId, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["yt", agentId] }) });
  const addSq = useMutation({ mutationFn: () => api.addSearchQuery(agentId, searchQ), onSuccess: () => { qc.invalidateQueries({ queryKey: ["sq", agentId] }); setSearchQ(""); } });
  const delSq = useMutation({ mutationFn: (id) => api.deleteSearchQuery(agentId, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["sq", agentId] }) });

  const FeedSection = ({ title, items, urlField, labelField, setUrl, setLabel, url, labelV, onAdd, onDelete, isPending, placeholder }) => (
    <div className="border border-gray-800 rounded-xl p-4 space-y-3">
      <h3 className="text-gray-300 text-sm font-medium">{title} ({items.length})</h3>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between text-sm">
            <span className="text-gray-300 truncate flex-1">{item[urlField] || item.query}</span>
            {item.label && <span className="text-gray-600 text-xs ml-2">{item.label}</span>}
            <button onClick={() => onDelete(item.id)} className="text-gray-600 hover:text-red-400 ml-3 text-xs transition-colors">Remove</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholder}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
        {setLabel && <input value={labelV} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)"
          className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />}
        <button onClick={onAdd} disabled={isPending || !url}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">Add</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <FeedSection title="RSS Feeds" items={rss} urlField="url" url={rssUrl} setUrl={setRssUrl} labelV={rssLabel} setLabel={setRssLabel} onAdd={() => addRss.mutate()} onDelete={(id) => delRss.mutate(id)} isPending={addRss.isPending} placeholder="https://example.com/feed" />
      <FeedSection title="YouTube Channels" items={yt} urlField="channel_id" url={ytId} setUrl={setYtId} labelV={ytLabel} setLabel={setYtLabel} onAdd={() => addYt.mutate()} onDelete={(id) => delYt.mutate(id)} isPending={addYt.isPending} placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxx" />
      <FeedSection title="Search Queries" items={sq} urlField="query" url={searchQ} setUrl={setSearchQ} labelV={null} setLabel={null} onAdd={() => addSq.mutate()} onDelete={(id) => delSq.mutate(id)} isPending={addSq.isPending} placeholder="Melbourne property news 2026" />
    </div>
  );
}

function PromptsTab({ agentId }) {
  const qc = useQueryClient();
  const { data: prompts = [] } = useQuery({ queryKey: ["prompts", agentId], queryFn: () => api.getPrompts(agentId) });
  const [editing, setEditing] = useState({});

  const save = useMutation({
    mutationFn: ({ key, content }) => api.savePrompt(agentId, key, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts", agentId] }),
  });
  const reset = useMutation({
    mutationFn: (key) => api.resetPrompt(agentId, key),
    onSuccess: (data, key) => { setEditing((e) => { const c = { ...e }; delete c[key]; return c; }); qc.invalidateQueries({ queryKey: ["prompts", agentId] }); },
  });

  return (
    <div className="space-y-4">
      {prompts.map((p) => {
        const current = editing[p.key] ?? p.content;
        const dirty = editing[p.key] !== undefined && editing[p.key] !== p.content;
        return (
          <div key={p.key} className="border border-gray-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-300 text-sm font-medium">{p.key}</span>
              <div className="flex gap-2">
                {p.is_default ? (
                  <span className="text-gray-600 text-xs">using default</span>
                ) : (
                  <button onClick={() => reset.mutate(p.key)} className="text-gray-500 hover:text-yellow-400 text-xs transition-colors">Reset to default</button>
                )}
                {dirty && (
                  <button onClick={() => save.mutate({ key: p.key, content: current })} className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors">Save</button>
                )}
              </div>
            </div>
            <textarea
              value={current}
              onChange={(e) => setEditing((ed) => ({ ...ed, [p.key]: e.target.value }))}
              rows={p.key.includes("system") ? 8 : 3}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono resize-y focus:outline-none focus:border-indigo-500"
            />
          </div>
        );
      })}
    </div>
  );
}

function RunsTab({ agentId }) {
  const qc = useQueryClient();
  const [activeRunId, setActiveRunId] = useState(null);

  const { data: runs = [] } = useQuery({
    queryKey: ["runs", agentId],
    queryFn: () => api.getRuns(agentId),
    refetchInterval: (query) => {
      const data = query.state.data;
      const active = (data || []).find((r) => ["queued", "running", "awaiting_review"].includes(r.status));
      return active ? 2000 : false;
    },
  });

  const { data: activeRun } = useQuery({
    queryKey: ["run", activeRunId],
    queryFn: () => api.getRun(activeRunId),
    enabled: !!activeRunId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return ["queued", "running", "awaiting_review"].includes(data?.status) ? 2000 : false;
    },
  });

  const { mutate: trigger, isPending: triggering } = useMutation({
    mutationFn: (mode) => api.triggerRun(agentId, mode),
    onSuccess: (data) => { setActiveRunId(data.runId); qc.invalidateQueries({ queryKey: ["runs", agentId] }); },
  });

  const { mutate: cancel, isPending: cancelling } = useMutation({
    mutationFn: (runId) => api.cancelRun(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs", agentId] });
      if (activeRunId) qc.invalidateQueries({ queryKey: ["run", activeRunId] });
    },
  });

  const latestActive = runs.find((r) => ["queued", "running", "awaiting_review"].includes(r.status));
  const displayRunId = activeRunId || latestActive?.id;
  const displayRun = activeRun || latestActive;
  const displayStatus = displayRun?.status;

  const STATUS_LABEL = {
    queued: "Queued — waiting for worker...",
    running: "Running...",
    awaiting_review: "Awaiting review",
  };

  return (
    <div className="space-y-5">
      <div className="flex gap-3 flex-wrap items-center">
        <button onClick={() => trigger("ingest")} disabled={triggering || !!latestActive}
          className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          Run Ingest
        </button>
        <button onClick={() => trigger("video")} disabled={triggering || !!latestActive}
          className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          Generate Videos
        </button>
        {latestActive && (
          <>
            <span className={`text-sm self-center ${displayStatus === "queued" ? "text-blue-400" : "text-yellow-400"}`}>
              {STATUS_LABEL[displayStatus] || "In progress..."}
            </span>
            <button
              onClick={() => cancel(latestActive.id)}
              disabled={cancelling}
              className="ml-auto bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
            >
              {cancelling ? "Cancelling..." : "Cancel Run"}
            </button>
          </>
        )}
      </div>

      {displayRunId && (
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-500 text-xs font-mono">Run: {displayRunId}</span>
            {displayStatus && (
              <span className={`text-xs font-medium ${STATUS_COLOR[displayStatus] || "text-gray-400"}`}>
                {displayStatus}
              </span>
            )}
          </div>
          <LogViewer runId={displayRunId} active={["queued", "running"].includes(displayStatus)} />
          {displayRun?.status === "awaiting_review" && (
            <ScriptReviewer run={displayRun} agentId={agentId} />
          )}
        </div>
      )}

      <div>
        <h3 className="text-gray-400 text-sm font-medium mb-3">Recent Runs</h3>
        <div className="space-y-1.5">
          {runs.map((run) => (
            <div
              key={run.id}
              onClick={() => setActiveRunId(run.id)}
              className="flex items-center justify-between bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg px-4 py-2.5 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium ${STATUS_COLOR[run.status] || "text-gray-400"}`}>{run.status}</span>
                <span className="text-gray-500 text-xs">{run.run_mode}</span>
              </div>
              <span className="text-gray-600 text-xs">{new Date(run.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState("Runs");

  const { data: agent, isLoading, isError } = useQuery({ queryKey: ["agent", id], queryFn: () => api.getAgent(id) });

  if (isLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">Loading...</div>;
  if (isError || !agent) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-red-400">Failed to load agent. Check the server logs.</div>;

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/" className="text-gray-500 hover:text-white text-sm transition-colors">← Agents</Link>
          <span className="text-gray-700">/</span>
          <h1 className="text-xl font-bold text-white">{agent?.name}</h1>
          <span className="text-gray-600 text-sm">{agent?.niche}</span>
        </div>

        <div className="flex gap-1 mb-6 border-b border-gray-800 pb-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${tab === t ? "text-white bg-gray-800" : "text-gray-500 hover:text-gray-300"}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div>
          {tab === "Settings" && <SettingsTab agentId={id} />}
          {tab === "Config" && <ConfigTab agentId={id} />}
          {tab === "Feeds" && <FeedsTab agentId={id} />}
          {tab === "Prompts" && <PromptsTab agentId={id} />}
          {tab === "Schedule" && <ScheduleManager agentId={id} />}
          {tab === "Runs" && <RunsTab agentId={id} />}
        </div>
      </div>
    </div>
  );
}
