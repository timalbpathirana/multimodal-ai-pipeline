# Content Generation AI Pipeline

Built by Timal Pathirana.

An AI-powered end to end content generation pipeline that ingests market signals, ranks insights, generates scripts using LLMs, and produces short-form content automatically.

---
<img width="1440" height="754" alt="Screenshot 2026-05-13 at 12 08 01 PM" src="https://github.com/user-attachments/assets/0bf95ee9-d23a-4bd1-91e5-d603c2fb5571" />

---
<img width="846" height="532" alt="Screenshot 2026-05-13 at 7 06 52 PM" src="https://github.com/user-attachments/assets/74d6148d-30db-4ca4-a8e1-02cd061fb630" />



## What is this platform?

This is a multi-agent AI content platform that automates short-form video content creation for social media. Each **Agent** represents a niche and runs a daily pipeline that:

1. Collects news and data from your configured feeds (RSS, YouTube, web search)
2. Uses AI to identify the most valuable market signal
3. Generates a short-form video script (TikTok / Instagram Reels)
4. Converts the script to voiceover via ElevenLabs
5. Combines audio and background video into a ready-to-post MP4

---

## Getting Started

**Step 1 — Set your Global API keys**
Go to **Global Settings** (bottom of the left menu) and enter your API keys. These apply to all agents by default. You need: Anthropic, ElevenLabs, Pexels, Airtable, and Serper keys.

**Step 2 — Create your first Agent**
Click **+ New Agent** on the Agents page. Give it a name and a niche slug (e.g. `australian_property`). The slug is used internally as an identifier.

**Step 3 — Configure Feeds**
Open your agent and go to the **Feeds** tab. Add RSS news feeds, YouTube channels, or search queries. These are the sources the AI reads from each run.

**Step 4 — Review Prompts (Very Important)**
The **Prompts** tab shows the AI prompts used at each stage. You can use the default prompt as a template to recreate your own prompt for your chosen niche.

**Step 5 — Schedule or Trigger a Run**
Use the **Schedule** tab to set a recurring cron job, or go to **Runs** and click **Trigger Run** to run immediately.

---

## Agent Settings

Inside each agent, the **Settings** tab lets you override global API keys and configure per-agent options:

| Setting | Description |
|---|---|
| **ElevenLabs Voice ID** | The voice used for your TikTok audio. Find IDs in your ElevenLabs dashboard. |
| **Pexels Override URL** | A specific Pexels video URL to always use as the background. Leave empty to use search queries. |
| **Airtable Base ID / Table** | Where generated scripts and story ideas are stored for review. |
| **Breaking News Mode** | When toggled on, uses an urgency-focused script prompt instead of the standard one. |

---

## Run Modes

| Mode | Description |
|---|---|
| `ingest` | Fetches fresh content from your RSS and YouTube feeds, then scores all stories. No script or video is produced. |
| `video` | Full pipeline — pulls top stories, generates a script, creates voiceover, fetches background video, and composes the final MP4. |

You can stop the video pipeline early via the **Run Modes** setting in the Settings tab: *Ingest only*, *Script only*, or *Voice only*.

---

## Run Statuses

| Status | Description |
|---|---|
| `queued` | Job is waiting for a worker to pick it up. |
| `running` | Pipeline is actively executing. |
| `awaiting_review` | Scripts generated — waiting for your approval. |
| `done` | Pipeline completed successfully. Output is ready. |
| `failed` | Something went wrong. Check the Runs tab logs for details. |

---

## Tips

> **Feed quality:** The output script is only as good as your feed sources. Use high-quality, niche-specific RSS feeds and reputable YouTube channels for best results.

> **Prompt editing:** Update prompts to get the best out of the pipeline. The defaults are to give you an idea of prompt.

> **Breaking News Mode:** Use this sparingly — only when there is genuinely urgent market news. Overusing it dilutes the urgency signal for your audience.

---

## Technical Stack

| Component | Technology |
|---|---|
| AI / LLM | Claude (Anthropic) |
| Voice | ElevenLabs |
| Video | FFmpeg |
| Job Queue | Trigger.dev |
| Web Search | Serper |
| Stock Video | Pexels |
| Storage | Airtable |
| Runtime | Node.js |
