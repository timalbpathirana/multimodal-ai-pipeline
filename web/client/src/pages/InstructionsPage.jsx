function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-800">
        {title}
      </h2>
      <div className="space-y-3 text-gray-400 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function Step({ number, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="w-7 h-7 rounded-full bg-indigo-600/20 border border-indigo-700/40 flex items-center justify-center text-indigo-400 text-xs font-bold shrink-0 mt-0.5">
        {number}
      </div>
      <div>
        <p className="text-white font-medium text-sm mb-1">{title}</p>
        <p className="text-gray-500 text-sm">{children}</p>
      </div>
    </div>
  );
}

function Callout({ label, children }) {
  return (
    <div className="bg-indigo-950/40 border border-indigo-800/40 rounded-lg px-4 py-3 text-sm">
      <span className="text-indigo-400 font-medium">{label}: </span>
      <span className="text-gray-400">{children}</span>
    </div>
  );
}

function Badge({ children, color = "gray" }) {
  const colors = {
    gray: "bg-gray-800 text-gray-400",
    green: "bg-green-900/30 text-green-400",
    yellow: "bg-yellow-900/30 text-yellow-400",
    purple: "bg-purple-900/30 text-purple-400",
    red: "bg-red-900/30 text-red-400",
  };
  return (
    <span
      className={`inline-block text-xs font-medium px-2 py-0.5 rounded-md ${colors[color]}`}
    >
      {children}
    </span>
  );
}

export default function InstructionsPage() {
  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">
          Platform Instructions
        </h1>
        <p className="text-gray-500 text-sm">
          Everything you need to know to set up and run AI-powered content
          agents.
        </p>
      </div>

      <div className="space-y-10">
        <Section title="What is this platform?">
          <p>
            This is a multi-agent AI content platform that automates short-form
            video content creation for social media. Each{" "}
            <strong className="text-gray-300">Agent</strong> represents a niche
            and runs a daily pipeline that:
          </p>
          <ol className="list-decimal list-inside space-y-1 text-gray-500 pl-1">
            <li>
              Collects news and data from your configured feeds (RSS, YouTube,
              web search)
            </li>
            <li>Uses AI to identify the most valuable market signal</li>
            <li>
              Generates a short-form video script (TikTok / Instagram Reels)
            </li>
            <li>Converts the script to voiceover via ElevenLabs</li>
            <li>
              Combines audio and background video into a ready-to-post MP4
            </li>
          </ol>
        </Section>

        <Section title="Getting Started">
          <div className="space-y-4">
            <Step number="1" title="Set your Global API keys">
              Go to <strong className="text-gray-300">Global Settings</strong>{" "}
              (bottom of the left menu) and enter your API keys. These apply to
              all agents by default. You need: Anthropic, ElevenLabs, Pexels,
              Airtable, and Serper keys.
            </Step>
            <Step number="2" title="Create your first Agent">
              Click <strong className="text-gray-300">+ New Agent</strong> on
              the Agents page. Give it a name and a niche slug (e.g.{" "}
              <code className="text-indigo-400 bg-indigo-950/40 px-1 rounded">
                australian_property
              </code>
              ). The slug is used internally as an identifier.
            </Step>
            <Step number="3" title="Configure Feeds">
              Open your agent and go to the{" "}
              <strong className="text-gray-300">Feeds</strong> tab. Add RSS news
              feeds, YouTube channels, or search queries. These are the sources
              the AI reads from each run.
            </Step>
            <Step number="4" title="Review Prompts (Very Important)">
              The <strong className="text-gray-300">Prompts</strong> tab shows
              the AI prompts used at each stage. You can use the default prompt
              as a template to recreate your own prompt for your chosen niche.
            </Step>
            <Step number="5" title="Schedule or Trigger a Run">
              Use the <strong className="text-gray-300">Schedule</strong> tab to
              set a recurring cron job, or go to{" "}
              <strong className="text-gray-300">Runs</strong> and click{" "}
              <strong className="text-gray-300">Trigger Run</strong> to run
              immediately.
            </Step>
          </div>
        </Section>

        <Section title="Agent Settings">
          <p>
            Inside each agent, the{" "}
            <strong className="text-gray-300">Settings</strong> tab lets you
            override global API keys and configure per-agent options:
          </p>
          <div className="space-y-2">
            <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 space-y-2">
              <div>
                <span className="text-gray-300 font-medium text-xs">
                  ElevenLabs Voice ID
                </span>
                <p className="text-gray-600 text-xs mt-0.5">
                  The voice used for your TikTok audio. Find IDs in your
                  ElevenLabs dashboard.
                </p>
              </div>
              <div>
                <span className="text-gray-300 font-medium text-xs">
                  Pexels Override URL
                </span>
                <p className="text-gray-600 text-xs mt-0.5">
                  A specific Pexels video URL to always use as the background.
                  Leave empty to use search queries.
                </p>
              </div>
              <div>
                <span className="text-gray-300 font-medium text-xs">
                  Airtable Base ID / Table
                </span>
                <p className="text-gray-600 text-xs mt-0.5">
                  Where generated scripts and story ideas are stored for review.
                </p>
              </div>
              <div>
                <span className="text-gray-300 font-medium text-xs">
                  Breaking News Mode
                </span>
                <p className="text-gray-600 text-xs mt-0.5">
                  When toggled on, uses an urgency-focused script prompt instead
                  of the standard one.
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Run Modes">
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Badge color="green">ingest</Badge>
              <p className="text-gray-500 text-sm">
                Fetches fresh content from your RSS and YouTube feeds, then
                scores all stories. No script or video is produced.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Badge color="purple">video</Badge>
              <p className="text-gray-500 text-sm">
                Full pipeline — pulls top stories, generates a script, creates
                voiceover, fetches background video, and composes the final MP4.
              </p>
            </div>
          </div>
          <p className="text-gray-600 text-xs mt-2">
            You can stop the video pipeline early via the{" "}
            <strong className="text-gray-500">Run Modes</strong> setting in the
            Settings tab: <em>Ingest only</em>, <em>Script only</em>, or{" "}
            <em>Voice only</em>.
          </p>
        </Section>

        <Section title="Run Statuses">
          <div className="space-y-2">
            {[
              {
                label: "queued",
                color: "gray",
                desc: "Job is waiting for a worker to pick it up.",
              },
              {
                label: "running",
                color: "yellow",
                desc: "Pipeline is actively executing.",
              },
              {
                label: "awaiting_review",
                color: "purple",
                desc: "Scripts generated — waiting for your approval.",
              },
              {
                label: "done",
                color: "green",
                desc: "Pipeline completed successfully. Output is ready.",
              },
              {
                label: "failed",
                color: "red",
                desc: "Something went wrong. Check the Runs tab logs for details.",
              },
            ].map(({ label, color, desc }) => (
              <div key={label} className="flex items-start gap-3">
                <Badge color={color}>{label}</Badge>
                <p className="text-gray-500 text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Tips">
          <Callout label="Feed quality">
            The output script is only as good as your feed sources. Use
            high-quality, niche-specific RSS feeds and reputable YouTube
            channels for best results.
          </Callout>
          <Callout label="Prompt editing">
            Update prompts to get the best out of the pipeline. The defaults are
            to give you an idea of prompt.
          </Callout>
          <Callout label="Breaking News Mode">
            Use this sparingly — only when there is genuinely urgent market
            news. Overusing it dilutes the urgency signal for your audience.
          </Callout>
        </Section>

        <Section title="Technical Stack">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              ["AI / LLM", "Claude (Anthropic)"],
              ["Voice", "ElevenLabs"],
              ["Video", "FFmpeg"],
              ["Job Queue", "Trigger.dev"],
              ["Web Search", "Serper"],
              ["Stock Video", "Pexels"],
              ["Storage", "Airtable"],
              ["Runtime", "Node.js"],
            ].map(([key, val]) => (
              <div
                key={key}
                className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2"
              >
                <p className="text-gray-600 text-xs">{key}</p>
                <p className="text-gray-300 font-medium text-xs mt-0.5">
                  {val}
                </p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
