import { useState, useRef, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import ScriptReviewer from "../components/ScriptReviewer";
import ScheduleManager from "../components/ScheduleManager";
import InstructionsPage from "./InstructionsPage";

const TABS = ["Settings", "Config", "Feeds", "Prompts", "Schedule", "Runs"];
const STATUS_COLOR = {
  done: "text-green-400",
  running: "text-yellow-400",
  queued: "text-blue-400",
  awaiting_review: "text-purple-400",
  failed: "text-red-400",
};

const IMPORTANCE_ORDER = ["critical", "high", "medium", "supporting"];

const IMPORTANCE_BADGE = {
  critical: {
    label: "Critical",
    cls: "bg-red-900/40 text-red-400 border-red-800",
  },
  high: {
    label: "High",
    cls: "bg-orange-900/40 text-orange-400 border-orange-800",
  },
  medium: {
    label: "Medium",
    cls: "bg-blue-900/40 text-blue-400 border-blue-800",
  },
  supporting: {
    label: "Supporting",
    cls: "bg-gray-800 text-gray-500 border-gray-700",
  },
};

const PROMPT_META = {
  signal_system: {
    title: "Signal Script",
    description:
      "Converts the ranked market signal into a 60-second TikTok script. Fires on every normal video run.",
    importance: "critical",
  },
  signal_system_bn: {
    title: "Breaking News Script",
    description:
      "Same as Signal Script but written for urgency. Only fires when Breaking News Mode is on.",
    importance: "high",
  },
  rank_system: {
    title: "Signal Ranker",
    description:
      "Picks the single best data point from all extracted candidates. Runs before every script generation.",
    importance: "high",
  },
  overview_system: {
    title: "Overview Script",
    description:
      "Fallback prompt. Fires when no signal scores high enough — generates a warm general market piece instead.",
    importance: "medium",
  },
  story_finder_system: {
    title: "Story Finder",
    description:
      "Weekly ingest prompt. Reads 7 days of content and generates story ideas saved to Airtable.",
    importance: "medium",
  },
  audience_context: {
    title: "Audience Context",
    description:
      "Defines who the audience is. Embedded inside signal prompts — shapes tone across all script output.",
    importance: "supporting",
  },
};

const SETTINGS_PROMPT_KEYS = new Set(["hashtags", "disclaimer"]);
const FEEDS_PROMPT_KEYS = new Set(["pexels_queries"]);

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
        className={`relative w-10 h-5 rounded-full overflow-hidden transition-colors ${value ? "bg-indigo-600" : "bg-gray-700"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? "translate-x-5" : "translate-x-0"}`}
        />
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
  const { data: settings } = useQuery({
    queryKey: ["settings", agentId],
    queryFn: () => api.getSettings(agentId),
  });
  const [form, setForm] = useState(null);
  const s = form || settings || {};
  const set = (k, v) => setForm((f) => ({ ...(f || s), [k]: v }));

  const { data: prompts = [] } = useQuery({
    queryKey: ["prompts", agentId],
    queryFn: () => api.getPrompts(agentId),
  });
  const [editingPrompt, setEditingPrompt] = useState({});

  const savePrompt = useMutation({
    mutationFn: ({ key, content }) => api.savePrompt(agentId, key, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts", agentId] }),
  });
  const resetPrompt = useMutation({
    mutationFn: (key) => api.resetPrompt(agentId, key),
    onSuccess: (_, key) => {
      setEditingPrompt((e) => {
        const c = { ...e };
        delete c[key];
        return c;
      });
      qc.invalidateQueries({ queryKey: ["prompts", agentId] });
    },
  });
  const getPromptField = (key) => prompts.find((p) => p.key === key);

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyError, setVerifyError] = useState(null);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError(null);
    try {
      const result = await api.verifyPexelsUrl(agentId, s.pexels_override_url);
      setVerifyResult(result);
    } catch (err) {
      setVerifyError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.saveSettings(agentId, s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", agentId] });
      setForm(null);
    },
  });

  return (
    <div className="space-y-4">
      <Field
        label="ElevenLabs Voice ID"
        value={s.elevenlabs_voice_id}
        onChange={(v) => set("elevenlabs_voice_id", v)}
        placeholder="cjVigY5qzO86Huf0OWal" //default free voice
      />
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Airtable Entries"
          value={s.stories_per_week}
          onChange={(v) => set("stories_per_week", parseInt(v) || 28)}
          type="number"
        />
        <Field
          label="Lookback Days"
          value={s.ingest_lookback_days}
          onChange={(v) => set("ingest_lookback_days", parseInt(v) || 7)}
          type="number"
        />
        <div>
          <label className="text-gray-400 text-sm block mb-1">Run Mode</label>
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
        <Toggle
          label="Breaking News Mode"
          value={!!s.is_breaking_news}
          onChange={(v) => set("is_breaking_news", v)}
          hint="Fetches fresh RSS/YouTube content instead of Airtable stories"
        />
        <Toggle
          label="Human-in-the-Loop"
          value={!!s.human_in_the_loop}
          onChange={(v) => set("human_in_the_loop", v)}
          hint="Pauses after script generation for manual hook review"
        />
      </div>

      <div className="border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-gray-300 text-sm font-medium">
              Override Pexels Video
            </span>
            <p className="text-gray-600 text-xs mt-0.5">
              When set, the pipeline loops this single video instead of
              searching by keyword
            </p>
          </div>
          {s.pexels_override_url && (
            <span className="text-xs bg-orange-900/40 text-orange-400 border border-orange-800 px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={s.pexels_override_url || ""}
            onChange={(e) => {
              set("pexels_override_url", e.target.value || null);
              setVerifyResult(null);
              setVerifyError(null);
            }}
            placeholder="https://www.pexels.com/video/..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleVerify}
            disabled={!s.pexels_override_url || verifying}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            {verifying ? "Checking..." : "Verify"}
          </button>
        </div>
        {verifyError && <p className="text-red-400 text-xs">{verifyError}</p>}
        {verifyResult && (
          <div className="rounded-lg overflow-hidden border border-gray-700">
            <video
              src={verifyResult.videoFileUrl}
              controls
              className="w-full max-h-72 bg-black"
            />
            <p className="text-gray-500 text-xs px-3 py-1.5">
              {verifyResult.width}×{verifyResult.height} ·{" "}
              {verifyResult.duration}s
            </p>
          </div>
        )}
        {s.pexels_override_url && (
          <button
            onClick={() => {
              set("pexels_override_url", null);
              setVerifyResult(null);
              setVerifyError(null);
            }}
            className="text-gray-600 hover:text-red-400 text-xs transition-colors"
          >
            Clear override
          </button>
        )}
      </div>

      <div className="border border-gray-800 rounded-xl p-4 space-y-4">
        <h3 className="text-gray-300 text-sm font-medium">Post Content</h3>
        {["hashtags", "disclaimer"].map((key) => {
          const p = getPromptField(key);
          if (!p) return null;
          const current = editingPrompt[key] ?? p.content;
          const dirty =
            editingPrompt[key] !== undefined &&
            editingPrompt[key] !== p.content;
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-gray-400 text-sm capitalize">
                  {key}
                </label>
                <div className="flex gap-2">
                  {!p.is_default && (
                    <button
                      onClick={() => resetPrompt.mutate(key)}
                      className="text-gray-500 hover:text-yellow-400 text-xs transition-colors"
                    >
                      Reset
                    </button>
                  )}
                  {dirty && (
                    <button
                      onClick={() =>
                        savePrompt.mutate({ key, content: current })
                      }
                      className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={current}
                onChange={(e) =>
                  setEditingPrompt((ed) => ({ ...ed, [key]: e.target.value }))
                }
                rows={key === "hashtags" ? 2 : 3}
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono resize-y focus:outline-none focus:border-indigo-500"
              />
            </div>
          );
        })}
      </div>

      <SaveButton onClick={() => save()} isPending={isPending} />
    </div>
  );
}

function ConfigTab({ agentId }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["settings", agentId],
    queryFn: () => api.getSettings(agentId),
  });
  const [form, setForm] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const s = form || settings || {};
  const set = (k, v) => setForm((f) => ({ ...(f || s), [k]: v }));

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.saveSettings(agentId, s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      setForm(null);
      setSaveError(null);
    },
    onError: (err) =>
      setSaveError(err?.message || "Save failed — check server logs"),
  });

  return (
    <div className="space-y-4">
      <p className="text-gray-500 text-xs">
        Leave blank to use global config defaults.
      </p>
      <div className="border border-gray-800 rounded-xl p-4 space-y-4">
        <h3 className="text-gray-300 text-sm font-medium">Airtable</h3>
        <Field
          label="Base ID"
          value={s.airtable_base_id}
          onChange={(v) => set("airtable_base_id", v)}
          placeholder="appXXXXXXXXXXXXXX"
        />
        <Field
          label="Table Name"
          value={s.airtable_table}
          onChange={(v) => set("airtable_table", v)}
          placeholder="Stories"
        />
        <Field
          label="API Key (override)"
          value={s.airtable_api_key}
          onChange={(v) => set("airtable_api_key", v)}
          type="password"
          placeholder="pat..."
        />
      </div>
      <div className="border border-gray-800 rounded-xl p-4 space-y-4">
        <h3 className="text-gray-300 text-sm font-medium">
          API Keys (per-agent overrides)
        </h3>
        <Field
          label="Anthropic API Key"
          value={s.anthropic_api_key}
          onChange={(v) => set("anthropic_api_key", v)}
          type="password"
          placeholder="sk-ant-..."
        />
        <Field
          label="ElevenLabs API Key"
          value={s.elevenlabs_api_key}
          onChange={(v) => set("elevenlabs_api_key", v)}
          type="password"
        />
        <Field
          label="Pexels API Key"
          value={s.pexels_api_key}
          onChange={(v) => set("pexels_api_key", v)}
          type="password"
        />
        <Field
          label="Serper API Key"
          value={s.serper_api_key}
          onChange={(v) => set("serper_api_key", v)}
          type="password"
        />
      </div>
      <div className="border border-gray-800 rounded-xl p-4 space-y-4">
        <h3 className="text-gray-300 text-sm font-medium">TikTok</h3>
        <Field
          label="Access Token"
          value={s.tiktok_access_token}
          onChange={(v) => set("tiktok_access_token", v)}
          type="password"
          hint="Expires every 24h — auto-refreshed if a Refresh Token is set below"
        />
        <Field
          label="Refresh Token"
          value={s.tiktok_refresh_token}
          onChange={(v) => set("tiktok_refresh_token", v)}
          type="password"
          hint="30-day TTL — paste once and token refreshes automatically"
        />
        <Field
          label="Open ID"
          value={s.tiktok_open_id}
          onChange={(v) => set("tiktok_open_id", v)}
        />
        <div>
          <label className="text-gray-400 text-sm block mb-1">
            Post Visibility
          </label>
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
        <Toggle
          label="Auto-post to TikTok"
          value={!!s.auto_post_to_tiktok}
          onChange={(v) => set("auto_post_to_tiktok", v)}
        />
      </div>
      <div className="border border-gray-800 rounded-xl p-4 space-y-4">
        <h3 className="text-gray-300 text-sm font-medium">Telegram</h3>
        <Field
          label="Bot Token"
          value={s.telegram_bot_token}
          onChange={(v) => set("telegram_bot_token", v)}
          type="password"
          hint="From @BotFather — e.g. 123456789:ABCdef..."
        />
        <Field
          label="Chat ID"
          value={s.telegram_chat_id}
          onChange={(v) => set("telegram_chat_id", v)}
          hint="Your user or group chat ID — message @userinfobot to find yours"
        />
        <Toggle
          label="Send video to Telegram after generation"
          value={!!s.auto_send_to_telegram}
          onChange={(v) => set("auto_send_to_telegram", v)}
          hint="Delivers each generated video to your Telegram chat when a run completes"
        />
      </div>
      <div className="space-y-2">
        <SaveButton onClick={() => save()} isPending={isPending} />
        {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
      </div>
    </div>
  );
}

function FeedSection({
  title,
  items,
  urlField,
  setUrl,
  setLabel,
  url,
  labelV,
  onAdd,
  onDelete,
  isPending,
  placeholder,
  error,
  renderBadge,
}) {
  return (
    <div className="border border-gray-800 rounded-xl p-4 space-y-3">
      <h3 className="text-gray-300 text-sm font-medium">
        {title} ({items.length})
      </h3>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-gray-300 truncate flex-1">
              {item[urlField] || item.query}
            </span>
            {renderBadge && renderBadge(item)}
            {item.label && (
              <span className="text-gray-600 text-xs ml-2">{item.label}</span>
            )}
            <button
              onClick={() => onDelete(item.id)}
              className="text-gray-600 hover:text-red-400 ml-3 text-xs transition-colors"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        {setLabel && (
          <input
            value={labelV}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        )}
        <button
          onClick={onAdd}
          disabled={isPending || !url}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function FeedsTab({ agentId }) {
  const qc = useQueryClient();
  const [rssUrl, setRssUrl] = useState("");
  const [rssLabel, setRssLabel] = useState("");
  const [ytId, setYtId] = useState("");
  const [ytLabel, setYtLabel] = useState("");
  const [ytError, setYtError] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [editingPexels, setEditingPexels] = useState(undefined);

  const { data: rss = [] } = useQuery({
    queryKey: ["rss", agentId],
    queryFn: () => api.getRssFeeds(agentId),
  });
  const { data: yt = [] } = useQuery({
    queryKey: ["yt", agentId],
    queryFn: () => api.getYoutubeFeeds(agentId),
  });
  const { data: sq = [] } = useQuery({
    queryKey: ["sq", agentId],
    queryFn: () => api.getSearchQueries(agentId),
  });
  const { data: prompts = [] } = useQuery({
    queryKey: ["prompts", agentId],
    queryFn: () => api.getPrompts(agentId),
  });
  const pexelsPrompt = prompts.find((p) => p.key === "pexels_queries");
  const pexelsCurrent = editingPexels ?? pexelsPrompt?.content ?? "";
  const pexelsDirty = editingPexels !== undefined && editingPexels !== pexelsPrompt?.content;

  const savePexels = useMutation({
    mutationFn: () => api.savePrompt(agentId, "pexels_queries", editingPexels),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompts", agentId] });
      setEditingPexels(undefined);
    },
  });
  const resetPexels = useMutation({
    mutationFn: () => api.resetPrompt(agentId, "pexels_queries"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompts", agentId] });
      setEditingPexels(undefined);
    },
  });

  const addRss = useMutation({
    mutationFn: () => api.addRssFeed(agentId, rssUrl, rssLabel),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rss", agentId] });
      setRssUrl("");
      setRssLabel("");
    },
  });
  const delRss = useMutation({
    mutationFn: (id) => api.deleteRssFeed(agentId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rss", agentId] }),
  });
  const addYt = useMutation({
    mutationFn: () => api.addYoutubeFeed(agentId, ytId, ytLabel),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["yt", agentId] });
      setYtId("");
      setYtLabel("");
      setYtError("");
    },
    onError: (err) => setYtError(err.message || "Failed to add channel."),
  });
  const delYt = useMutation({
    mutationFn: (id) => api.deleteYoutubeFeed(agentId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["yt", agentId] }),
  });
  const addSq = useMutation({
    mutationFn: () => api.addSearchQuery(agentId, searchQ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sq", agentId] });
      setSearchQ("");
    },
  });
  const delSq = useMutation({
    mutationFn: (id) => api.deleteSearchQuery(agentId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sq", agentId] }),
  });

  return (
    <div className="space-y-4">
      <FeedSection
        title="RSS Feeds"
        items={rss}
        urlField="url"
        url={rssUrl}
        setUrl={setRssUrl}
        labelV={rssLabel}
        setLabel={setRssLabel}
        onAdd={() => addRss.mutate()}
        onDelete={(id) => delRss.mutate(id)}
        isPending={addRss.isPending}
        placeholder="https://example.com/feed"
      />
      <FeedSection
        title="YouTube Channels"
        items={yt}
        urlField="channel_id"
        url={ytId}
        setUrl={setYtId}
        labelV={ytLabel}
        setLabel={setYtLabel}
        onAdd={() => addYt.mutate()}
        onDelete={(id) => delYt.mutate(id)}
        isPending={addYt.isPending}
        placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxx"
        error={ytError}
        renderBadge={(item) =>
          item.captions_available === true ? (
            <span
              className="text-green-400 text-xs ml-2"
              title="Captions verified"
            >
              ✓
            </span>
          ) : null
        }
      />
      <FeedSection
        title="Search Queries"
        items={sq}
        urlField="query"
        url={searchQ}
        setUrl={setSearchQ}
        labelV={null}
        setLabel={null}
        onAdd={() => addSq.mutate()}
        onDelete={(id) => delSq.mutate(id)}
        isPending={addSq.isPending}
        placeholder="Melbourne property news 2026"
      />
      <div className="border border-gray-800 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-gray-300 text-sm font-medium">Pexels Video Queries</span>
            <p className="text-gray-600 text-xs mt-0.5">One query per line. The pipeline cycles through these when searching for background video.</p>
          </div>
          <div className="flex gap-3 items-center">
            {pexelsPrompt && !pexelsPrompt.is_default && (
              <button
                onClick={() => resetPexels.mutate()}
                className="text-gray-500 hover:text-yellow-400 text-xs transition-colors"
              >
                Reset to default
              </button>
            )}
            {pexelsDirty && (
              <button
                onClick={() => savePexels.mutate()}
                disabled={savePexels.isPending}
                className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors disabled:opacity-50"
              >
                {savePexels.isPending ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </div>
        <textarea
          value={pexelsCurrent}
          onChange={(e) => setEditingPexels(e.target.value)}
          rows={8}
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono resize-y focus:outline-none focus:border-indigo-500"
        />
      </div>
    </div>
  );
}

function PromptsTab({ agentId }) {
  const qc = useQueryClient();
  const { data: prompts = [] } = useQuery({
    queryKey: ["prompts", agentId],
    queryFn: () => api.getPrompts(agentId),
  });
  const [editing, setEditing] = useState({});

  const save = useMutation({
    mutationFn: ({ key, content }) => api.savePrompt(agentId, key, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts", agentId] }),
  });
  const reset = useMutation({
    mutationFn: (key) => api.resetPrompt(agentId, key),
    onSuccess: (_, key) => {
      setEditing((e) => {
        const c = { ...e };
        delete c[key];
        return c;
      });
      qc.invalidateQueries({ queryKey: ["prompts", agentId] });
    },
  });

  const visible = prompts
    .filter(
      (p) => !SETTINGS_PROMPT_KEYS.has(p.key) && !FEEDS_PROMPT_KEYS.has(p.key),
    )
    .sort((a, b) => {
      const ai = IMPORTANCE_ORDER.indexOf(PROMPT_META[a.key]?.importance ?? "");
      const bi = IMPORTANCE_ORDER.indexOf(PROMPT_META[b.key]?.importance ?? "");
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  return (
    <div className="space-y-4">
      {visible.map((p) => {
        const meta = PROMPT_META[p.key];
        const badge = meta ? IMPORTANCE_BADGE[meta.importance] : null;
        const current = editing[p.key] ?? p.content;
        const dirty =
          editing[p.key] !== undefined && editing[p.key] !== p.content;
        return (
          <div
            key={p.key}
            className="border border-gray-800 rounded-xl p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  {badge && (
                    <span
                      className={`text-xs border px-1.5 py-0.5 rounded shrink-0 ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  )}
                  <span className="text-gray-200 text-sm font-medium">
                    {meta?.title ?? p.key}
                  </span>
                </div>
                {meta?.description && (
                  <p className="text-gray-500 text-xs leading-relaxed">
                    {meta.description}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0 items-center">
                {p.is_default ? (
                  <span className="text-gray-600 text-xs">default</span>
                ) : (
                  <button
                    onClick={() => reset.mutate(p.key)}
                    className="text-gray-500 hover:text-yellow-400 text-xs transition-colors"
                  >
                    Reset
                  </button>
                )}
                {dirty && (
                  <button
                    onClick={() =>
                      save.mutate({ key: p.key, content: current })
                    }
                    className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
                  >
                    Save
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={current}
              onChange={(e) =>
                setEditing((ed) => ({ ...ed, [p.key]: e.target.value }))
              }
              rows={10}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono resize-y focus:outline-none focus:border-indigo-500"
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Run helpers ───────────────────────────────────────────────────────────────

function Badge({ color, label }) {
  const cls = {
    orange: "bg-orange-900/30 text-orange-400 border-orange-800/50",
    red: "bg-red-900/30 text-red-400 border-red-800/50",
    purple: "bg-purple-900/30 text-purple-400 border-purple-800/50",
    yellow: "bg-yellow-900/30 text-yellow-400 border-yellow-800/50",
    blue: "bg-blue-900/30 text-blue-400 border-blue-800/50",
  };
  return (
    <span
      className={`text-xs border px-1.5 py-0.5 rounded ${cls[color] || cls.blue}`}
    >
      {label}
    </span>
  );
}

function detectStages(logs, run) {
  if (!run) return [];
  const snap = run.settings_snapshot || {};
  const isIngest = run.run_mode === "ingest";

  const cfg = isIngest
    ? [
        {
          key: "start",
          label: "Starting",
          pattern: /Worker picked up ingest/i,
        },
        {
          key: "fetch",
          label: "Fetching Feeds",
          pattern: /rss|youtube|fetching|ingesting/i,
        },
        {
          key: "score",
          label: "Scoring Stories",
          pattern: /signal|score|top signal/i,
        },
        {
          key: "done",
          label: "Complete",
          pattern: /Done.*ingest|Ingested \d+ items/i,
        },
      ]
    : [
        { key: "start", label: "Starting", pattern: /Worker picked up/i },
        {
          key: "story",
          label: "Fetch Stories",
          pattern: /Phase 1|Pulled story|Breaking news mode|story \d+/i,
        },
        {
          key: "script",
          label: "Generate Script",
          pattern: /Script \d+ ready|hook=|generating.*hook/i,
        },
        {
          key: "voice",
          label: "Generate Voice",
          pattern: /\[voice\]|\[elevenlabs\]|Voice written/i,
        },
        {
          key: "video",
          label: "Fetch Video",
          pattern: /\[pexels\]|Downloading clip/i,
        },
        {
          key: "compose",
          label: "Compose Video",
          pattern: /\[ffmpeg\]|Concatenating/i,
        },
        { key: "caption", label: "Add Captions", pattern: /\[subtitles\]/i },
        ...(snap.auto_post_to_tiktok
          ? [
              {
                key: "tiktok",
                label: "Post to TikTok",
                pattern: /TikTok|publish_id/i,
              },
            ]
          : []),
        {
          key: "finish",
          label: "Finalise Video",
          pattern: /Done in.*s\.|All.*video.*done/i,
        },
        ...(snap.auto_send_to_telegram
          ? [
              {
                key: "telegram",
                label: "Send to Telegram",
                pattern: /\[telegram\]/i,
              },
            ]
          : []),
      ];

  const reached = cfg.map((s) => s.pattern.test(logs));

  return cfg.map((s, i) => {
    if (run.status === "done") return { ...s, state: "done" };
    if (!reached[i]) return { ...s, state: "pending" };
    const laterReached = reached.slice(i + 1).some(Boolean);
    if (laterReached || run.status === "failed") return { ...s, state: "done" };
    return { ...s, state: "active" };
  });
}

function PipelineStages({ stages }) {
  return (
    <div>
      {stages.map((stage, i) => (
        <div key={stage.key} className="flex gap-3 relative">
          {i < stages.length - 1 && (
            <div
              className={`absolute left-[11px] top-6 w-px h-full ${stage.state === "done" ? "bg-green-800" : "bg-gray-800"}`}
            />
          )}
          <div
            className={`relative z-10 w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${
              stage.state === "done"
                ? "bg-green-900 border border-green-700 text-green-400"
                : stage.state === "active"
                  ? "bg-indigo-900 border border-indigo-500 text-indigo-300"
                  : "bg-gray-900 border border-gray-700 text-gray-600"
            }`}
          >
            {stage.state === "done" ? "✓" : "·"}
          </div>
          <div className="pb-5 min-w-0">
            <p
              className={`text-sm leading-[22px] ${
                stage.state === "done"
                  ? "text-gray-500"
                  : stage.state === "active"
                    ? "text-white font-medium"
                    : "text-gray-600"
              }`}
            >
              {stage.label}
            </p>
            {stage.state === "active" && (
              <div className="flex gap-1 -mt-1.5 mb-1">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function RunsTab({ agentId }) {
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [confirmIngest, setConfirmIngest] = useState(false);
  const logsRef = useRef(null);

  const { data: runs = [] } = useQuery({
    queryKey: ["runs", agentId],
    queryFn: () => api.getRuns(agentId),
    refetchInterval: (query) => {
      const active = (query.state.data || []).find((r) =>
        ["queued", "running", "awaiting_review"].includes(r.status),
      );
      return active ? 2000 : false;
    },
  });

  const latestActive = runs.find((r) =>
    ["queued", "running", "awaiting_review"].includes(r.status),
  );
  const displayRunId = selectedRunId || latestActive?.id || runs[0]?.id;
  const listRun = runs.find((r) => r.id === displayRunId);

  const { data: fullRun } = useQuery({
    queryKey: ["run", displayRunId],
    queryFn: () => api.getRun(displayRunId),
    enabled: !!displayRunId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return ["queued", "running", "awaiting_review"].includes(s)
        ? 2000
        : false;
    },
  });

  const displayRun = listRun || fullRun || null;
  const isLive =
    !!displayRun && ["queued", "running"].includes(displayRun.status);

  const { data: logsData } = useQuery({
    queryKey: ["run-logs", displayRunId],
    queryFn: () => api.getRunLogs(displayRunId),
    enabled: !!displayRunId,
    refetchInterval: isLive ? 2000 : false,
  });
  const logs = logsData?.logs || "";

  useEffect(() => {
    if (logsRef.current)
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const { mutate: trigger, isPending: triggering } = useMutation({
    mutationFn: (mode) => api.triggerRun(agentId, mode),
    onSuccess: (data) => {
      setSelectedRunId(data.runId);
      qc.invalidateQueries({ queryKey: ["runs", agentId] });
    },
  });

  const { mutate: cancel, isPending: cancelling } = useMutation({
    mutationFn: (runId) => api.cancelRun(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs", agentId] });
      qc.invalidateQueries({ queryKey: ["run", displayRunId] });
    },
  });

  const stages = detectStages(logs, displayRun);
  const outputPaths = displayRun?.output_paths || [];

  return (
    <div className="space-y-5">
      {/* Confirmation modal */}
      {confirmIngest && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <p className="text-white font-semibold text-base mb-1">
              Run Ingest?
            </p>
            <p className="text-gray-400 text-sm mb-6">
              This will fetch fresh content from your RSS and YouTube feeds and
              score all stories. Continue?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmIngest(false)}
                className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  trigger("ingest");
                  setConfirmIngest(false);
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors"
              >
                Run Ingest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setConfirmIngest(true)}
          disabled={triggering || !!latestActive}
          className="bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm px-5 py-2.5 rounded-xl font-medium transition-colors"
        >
          Run Ingest
        </button>
        <button
          onClick={() => trigger("video")}
          disabled={triggering || !!latestActive}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm px-5 py-2.5 rounded-xl font-medium transition-colors"
        >
          Generate
        </button>
        {latestActive && (
          <>
            <div className="flex items-center gap-2 ml-1">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0" />
              <span className="text-gray-400 text-sm">
                {latestActive.status === "queued"
                  ? "Queued..."
                  : latestActive.status === "awaiting_review"
                    ? "Awaiting review"
                    : "Running..."}
              </span>
            </div>
            <button
              onClick={() => cancel(latestActive.id)}
              disabled={cancelling}
              className="ml-auto bg-red-900/40 hover:bg-red-800/60 border border-red-800/60 disabled:opacity-40 text-red-300 text-sm px-4 py-2 rounded-xl transition-colors"
            >
              {cancelling ? "Cancelling..." : "Cancel Run"}
            </button>
          </>
        )}
      </div>

      {/* Run detail panel */}
      {displayRun && (
        <div className="border border-gray-800 rounded-2xl overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-3 bg-gray-900/60 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <span className="text-gray-200 text-sm font-medium">
                {displayRun.run_mode === "ingest"
                  ? "Ingest Run"
                  : "Video Generation"}
              </span>
              <span className="text-gray-600 text-xs font-mono">
                {displayRunId?.slice(0, 8)}
              </span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  displayRun.status === "done"
                    ? "bg-green-900/50 text-green-400"
                    : displayRun.status === "failed"
                      ? "bg-red-900/50 text-red-400"
                      : displayRun.status === "running"
                        ? "bg-yellow-900/50 text-yellow-400"
                        : displayRun.status === "queued"
                          ? "bg-blue-900/50 text-blue-400"
                          : displayRun.status === "awaiting_review"
                            ? "bg-purple-900/50 text-purple-400"
                            : "bg-gray-800 text-gray-400"
                }`}
              >
                {displayRun.status}
              </span>
            </div>
            {displayRun.created_at && (
              <span className="text-gray-600 text-xs">
                {new Date(displayRun.created_at).toLocaleString()}
              </span>
            )}
          </div>

          {/* Split panel */}
          <div className="grid grid-cols-[210px_1fr] divide-x divide-gray-800">
            {/* Left: pipeline stages */}
            <div className="p-5 bg-gray-950/40">
              <p className="text-gray-600 text-xs font-medium uppercase tracking-widest mb-4">
                Pipeline
              </p>
              <PipelineStages stages={stages} />
            </div>

            {/* Right: live logs */}
            <div className="flex flex-col min-w-0">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950/20">
                <span className="text-gray-600 text-xs font-medium uppercase tracking-widest">
                  Logs
                </span>
                {isLive && (
                  <span className="flex items-center gap-1.5 text-xs text-green-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              <pre
                ref={logsRef}
                className="flex-1 p-4 text-xs font-mono text-green-400 whitespace-pre-wrap overflow-y-auto min-h-64 max-h-96 bg-gray-950/10"
              >
                {logs || (
                  <span className="text-gray-600 italic">
                    {isLive
                      ? "Waiting for worker to pick up job..."
                      : "No logs for this run."}
                  </span>
                )}
              </pre>
            </div>
          </div>

          {/* Script reviewer (awaiting HITL review) */}
          {(fullRun || displayRun)?.status === "awaiting_review" && (
            <div className="border-t border-gray-800 p-5">
              <ScriptReviewer run={fullRun || displayRun} agentId={agentId} />
            </div>
          )}

          {/* Completion indicator */}
          {displayRun.status === "done" && outputPaths.length > 0 && (
            <div className="border-t border-gray-800 px-5 py-4 bg-gray-900/30">
              <p className="text-gray-300 text-sm font-medium">
                {outputPaths.length} video{outputPaths.length !== 1 ? "s" : ""}{" "}
                ready
              </p>
              <p className="text-gray-600 text-xs mt-0.5">
                Delivered to Telegram
              </p>
            </div>
          )}
        </div>
      )}

      {/* Run history */}
      <div>
        <p className="text-gray-600 text-xs font-medium uppercase tracking-widest mb-3">
          Recent Runs
        </p>
        {runs.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-10">
            No runs yet. Start with Run Ingest or Generate Videos above.
          </p>
        ) : (
          <div className="space-y-1.5">
            {runs.map((run) => {
              const snap = run.settings_snapshot || {};
              const isSelected = run.id === displayRunId;
              return (
                <button
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors ${
                    isSelected
                      ? "bg-gray-800 border-gray-700"
                      : "bg-gray-900/20 border-gray-800/60 hover:bg-gray-800/50 hover:border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span
                      className={`text-xs font-semibold ${STATUS_COLOR[run.status] || "text-gray-400"}`}
                    >
                      {run.status}
                    </span>
                    <span className="text-gray-500 text-xs bg-gray-800 px-1.5 py-0.5 rounded">
                      {run.run_mode}
                    </span>
                    {snap.pexels_override_url && (
                      <Badge color="orange" label="Override Video" />
                    )}
                    {snap.is_breaking_news && (
                      <Badge color="red" label="Breaking News" />
                    )}
                    {snap.human_in_the_loop && (
                      <Badge color="purple" label="HITL" />
                    )}
                    {snap.pipeline_stop_after && (
                      <Badge
                        color="yellow"
                        label={`Stop: ${snap.pipeline_stop_after}`}
                      />
                    )}
                    {snap.auto_post_to_tiktok && (
                      <Badge color="blue" label="Auto-Post" />
                    )}
                  </div>
                  <span className="text-gray-600 text-xs shrink-0 ml-4">
                    {run.created_at
                      ? new Date(run.created_at).toLocaleString()
                      : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState("Runs");
  const [showInstructions, setShowInstructions] = useState(false);

  const {
    data: agent,
    isLoading,
    isError,
  } = useQuery({ queryKey: ["agent", id], queryFn: () => api.getAgent(id) });

  if (isLoading)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  if (isError || !agent)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-red-400">
        Failed to load agent. Check the server logs.
      </div>
    );

  return (
    <div className="flex bg-gray-950">
      {/* Main agent content */}
      <div className="flex-1 p-6 min-w-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Link
              to="/"
              className="text-gray-500 hover:text-white text-sm transition-colors"
            >
              ← Agents
            </Link>
            <span className="text-gray-700">/</span>
            <h1 className="text-xl font-bold text-white">{agent?.name}</h1>
            <span className="text-gray-600 text-sm">{agent?.niche}</span>
            <button
              onClick={() => setShowInstructions((v) => !v)}
              title={showInstructions ? "Hide instructions" : "Show instructions"}
              className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showInstructions
                  ? "bg-indigo-600/20 border-indigo-700/40 text-indigo-400"
                  : "border-gray-700 text-gray-500 hover:text-white hover:border-gray-600"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              {showInstructions ? "Hide Docs" : "Show Docs"}
            </button>
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

      {/* Instructions side panel — sticky so it stays in view while the main content scrolls */}
      {showInstructions && (
        <div className="w-[420px] shrink-0 border-l border-gray-800 overflow-y-auto bg-gray-950 sticky top-0 h-screen">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
            <span className="text-gray-400 text-xs font-medium uppercase tracking-widest">
              Docs
            </span>
            <button
              onClick={() => setShowInstructions(false)}
              className="text-gray-600 hover:text-white text-xs transition-colors"
            >
              ✕ Close
            </button>
          </div>
          <InstructionsPage />
        </div>
      )}
    </div>
  );
}
