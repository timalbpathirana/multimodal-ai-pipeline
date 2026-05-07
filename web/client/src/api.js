async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (email, password) => apiFetch("/api/auth/login", { method: "POST", body: { email, password } }),
  logout: () => apiFetch("/api/auth/logout", { method: "POST" }),
  me: () => apiFetch("/api/auth/me"),

  // Global config
  getConfig: () => apiFetch("/api/config"),
  saveConfig: (data) => apiFetch("/api/config", { method: "PUT", body: data }),

  // Agents
  getAgents: () => apiFetch("/api/agents"),
  createAgent: (data) => apiFetch("/api/agents", { method: "POST", body: data }),
  getAgent: (id) => apiFetch(`/api/agents/${id}`),
  updateAgent: (id, data) => apiFetch(`/api/agents/${id}`, { method: "PUT", body: data }),
  deleteAgent: (id) => apiFetch(`/api/agents/${id}`, { method: "DELETE" }),

  // Settings
  getSettings: (id) => apiFetch(`/api/agents/${id}/settings`),
  saveSettings: (id, data) => apiFetch(`/api/agents/${id}/settings`, { method: "PUT", body: data }),

  // Feeds
  getRssFeeds: (id) => apiFetch(`/api/agents/${id}/feeds/rss`),
  addRssFeed: (id, url, label) => apiFetch(`/api/agents/${id}/feeds/rss`, { method: "POST", body: { url, label } }),
  deleteRssFeed: (id, feedId) => apiFetch(`/api/agents/${id}/feeds/rss/${feedId}`, { method: "DELETE" }),
  getYoutubeFeeds: (id) => apiFetch(`/api/agents/${id}/feeds/youtube`),
  addYoutubeFeed: (id, channel_id, label) => apiFetch(`/api/agents/${id}/feeds/youtube`, { method: "POST", body: { channel_id, label } }),
  deleteYoutubeFeed: (id, feedId) => apiFetch(`/api/agents/${id}/feeds/youtube/${feedId}`, { method: "DELETE" }),
  getSearchQueries: (id) => apiFetch(`/api/agents/${id}/feeds/search`),
  addSearchQuery: (id, query) => apiFetch(`/api/agents/${id}/feeds/search`, { method: "POST", body: { query } }),
  deleteSearchQuery: (id, queryId) => apiFetch(`/api/agents/${id}/feeds/search/${queryId}`, { method: "DELETE" }),

  // Prompts
  getPrompts: (id) => apiFetch(`/api/agents/${id}/prompts`),
  savePrompt: (id, key, content) => apiFetch(`/api/agents/${id}/prompts/${key}`, { method: "PUT", body: { content } }),
  resetPrompt: (id, key) => apiFetch(`/api/agents/${id}/prompts/${key}`, { method: "DELETE" }),

  // Schedules
  getSchedules: (id) => apiFetch(`/api/agents/${id}/schedules`),
  createSchedule: (id, data) => apiFetch(`/api/agents/${id}/schedules`, { method: "POST", body: data }),
  updateSchedule: (id, sid, data) => apiFetch(`/api/agents/${id}/schedules/${sid}`, { method: "PATCH", body: data }),
  deleteSchedule: (id, sid) => apiFetch(`/api/agents/${id}/schedules/${sid}`, { method: "DELETE" }),

  // Runs
  getRuns: (id) => apiFetch(`/api/agents/${id}/runs`),
  triggerRun: (id, mode) => apiFetch(`/api/agents/${id}/runs`, { method: "POST", body: { mode } }),
  getRun: (runId) => apiFetch(`/api/runs/${runId}`),
  getRunLogs: (runId) => apiFetch(`/api/runs/${runId}/logs`),
  cancelRun: (runId) => apiFetch(`/api/runs/${runId}/cancel`, { method: "POST" }),
  approveScripts: (runId, scripts) => apiFetch(`/api/runs/${runId}/approve`, { method: "POST", body: { scripts } }),
};
