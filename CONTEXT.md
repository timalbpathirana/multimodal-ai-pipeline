# Melbourne Property AI Content Agent

## 1. Idea

Build an automated AI-driven pipeline that:

- Collects daily updates from Melbourne real estate data sources
- Extracts the most relevant market change
- Generates a short-form (10–20 second) script
- Converts the script into a voiceover
- Produces a short video
- Publishes consistently to social platforms (starting with Instagram)

The system runs once per day and outputs a ready-to-post video.

---

## 2. Why This Idea

### Market Opportunity

- Real estate is a **high-value niche** (property transactions = large commissions)
- Most content is:
  - Slow (weekly/monthly updates)
  - Generic (no clear takeaway)
  - Opinion-heavy (not data-driven)

### Gap

There is no **daily, fast, data-backed, short-form content** focused specifically on Melbourne property.

### Strategic Advantage

- Automation enables **daily consistency**
- AI enables **fast synthesis of multiple sources**
- Short-form content enables **distribution scale**

### Long-Term Vision

This is not just content creation. It is:

- A **lead generation engine**
- A **real estate media asset**
- A potential **deal pipeline generator**

---

## 3. Goals

### Short-Term (0–1 month)

- Build a working MVP pipeline
- Generate 1 video per day
- Post consistently on Instagram

### Mid-Term (1–3 months)

- Expand to TikTok and YouTube Shorts
- Improve hook quality and retention
- Start generating inbound interest (DMs, followers)

### Long-Term (3–12 months)

- Monetisation via:
  - Referrals (buyers, brokers)
  - Partnerships (agents, platforms)
  - Digital products (reports, insights)

- Establish authority in Melbourne property niche

---

## 4. MVP Goal

Build a **fully automated daily pipeline** that:

1. Fetches 3–5 recent real estate news items
2. Extracts ONE key insight using an LLM
3. Generates a 10–20 second script
4. Converts script to voice
5. Combines voice with a simple background video
6. Outputs a final `.mp4` file ready for posting

👉 Manual posting to Instagram is acceptable for MVP

---

## 5. Success Criteria (MVP)

The MVP is successful if:

- ✅ Script is generated automatically from real data
- ✅ Voice file is generated
- ✅ Video file is generated (playable `.mp4`)
- ✅ Entire pipeline runs end-to-end without manual intervention
- ✅ Can be triggered manually and via scheduled job
- ✅ Output is usable for social media posting

---

## 6. Content Strategy Overview

### Format (10–20 seconds)

- Hook (0–3 sec)
- Insight (data-driven)
- Reason (why it’s happening)
- Implication (what it means for viewer)
- CTA (follow for updates)

### Positioning

- Fast
- Clear
- Slightly opinionated
- Data-backed

### Content Type

- Daily market changes
- Supply/demand shifts
- Price movements
- Auction clearance rates
- Interest rate implications

---

## 7. Technical Architecture (High-Level)

### Pipeline Flow

```
Data Sources
   ↓
Ingestion (RSS/API)
   ↓
LLM Analysis (Claude)
   ↓
Script Generation
   ↓
Text-to-Speech (ElevenLabs)
   ↓
Video Generation (FFmpeg)
   ↓
Output File (.mp4)
```

---

## 8. Technical Stack

### Core

- Node.js (runtime)
- Claude API (LLM for analysis + script)
- Trigger.dev (job scheduling + orchestration)

### Data Ingestion

- RSS feeds (e.g. real estate news sites)
- YouTube transcripts from channels such as @PersonalFinancewithRaviSharma,

### Media Generation

- ElevenLabs (text-to-speech)
- FFmpeg (video composition)

### Storage (optional for MVP)

- Local filesystem
- Future: S3 or cloud storage

---

## 9. Components Breakdown

### 1. Data Ingestion

- Fetch latest articles via RSS
- Fetch latest youtube transcripts from approved channels
- Limit to 3–5 items
- Extract:
  - Title
  - Summary/content
  - URL

---

### 2. LLM Processing (Claude)

Responsibilities:

- Identify the most important market change
- Remove noise and fluff
- Generate structured short-form script

Constraints:

- Single insight only
- Prefer numeric/stat-based insights
- Keep output concise

---

### 3. Script Generation

Output format:

```
HOOK:
INSIGHT:
IMPACT:
```

Length:

- 10–20 seconds when spoken

---

### 4. Voice Generation

- Input: script text
- Output: `voice.mp3`
- Requirements:
  - Clear, neutral tone
  - Consistent voice

---

### 5. Video Generation

- Input:
  - Background video (`.mp4`)
  - Voice file (`.mp3`)

- Process:
  - Combine audio + video
  - Trim to audio length
  - Optional text overlay

- Output:
  - `output.mp4`

---

### 6. Orchestration

- Trigger.dev scheduled job (daily)
- Executes full pipeline
- Handles retries/logging

---

## 10. MVP Constraints

To keep build lean:

- No auto-posting (manual upload)
- No subtitles (add later)
- No database
- No advanced scoring system

---

## 11. Future Enhancements (Post-MVP)

- Subtitles (critical for engagement)
- Multi-source credibility scoring
- 2 or more YouTube channel ingestion
- Auto-posting to social platforms
- Analytics tracking (views, engagement)
- Content variation (hooks, tones)
- Email capture funnel

---

## 12. Key Risks

- Low-quality input → weak insights
- Generic scripts → low engagement
- Overengineering early → delays

Mitigation:

- Keep sources high-quality
- Keep scripts sharp and specific
- Focus on consistency over perfection

---

## 13. Guiding Principle

This system is not just a content generator.

It is a:

> **Daily, automated signal extraction engine for Melbourne property**

The goal is to:

- Deliver clarity quickly
- Build trust over time
- Convert attention into opportunity
