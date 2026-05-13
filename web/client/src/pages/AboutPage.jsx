function SocialLink({ href, label, icon }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
    >
      {icon}
      {label}
    </a>
  );
}

function LinkedInIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function WhyCard({ title, children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-white font-medium text-sm mb-2">{title}</h3>
      <p className="text-gray-500 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">About the Creator</h1>
        <p className="text-gray-500 text-sm">The person behind this platform and why it exists.</p>
      </div>

      <div className="space-y-8">
        {/* Creator card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl select-none">
              T
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg">Timal Pathirana</h2>
              <p className="text-gray-500 text-sm">Builder · AI & Automation Enthusiast</p>
            </div>
          </div>
          <p className="text-gray-400 text-sm leading-relaxed mb-4">
            I'm a builder based in Melbourne who is obsessed with using AI and automation to solve real-world problems.
            My background spans software engineering and product — and I spend most of my time building systems that
            run themselves so humans can focus on things that actually matter.
          </p>
          <div className="flex flex-wrap gap-4">
            <SocialLink
              href="https://www.linkedin.com/in/timal-pathirana"
              label="LinkedIn"
              icon={<LinkedInIcon />}
            />
          </div>
        </div>

        {/* Why I built this */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-800">
            Why I built this
          </h2>
          <div className="space-y-3">
            <WhyCard title="The problem I kept seeing">
              Real estate content is mostly slow, generic, and opinion-heavy. There's almost no fast,
              data-driven, daily short-form content in the Melbourne property space — or most property
              niches for that matter. The gap was obvious.
            </WhyCard>
            <WhyCard title="What I wanted to prove">
              I wanted to prove that a single person with AI tools and a well-designed pipeline could
              produce consistent, high-quality daily content that competes with entire media teams. Not
              by working harder — but by building smarter systems.
            </WhyCard>
            <WhyCard title="It became something bigger">
              What started as a Melbourne property agent became a generalised multi-tenant content
              platform. The pipeline is niche-agnostic — any vertical with daily data signals can use it.
              I decided to build it properly and share it.
            </WhyCard>
          </div>
        </section>

        {/* Why it's free */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-800">
            Why it's free
          </h2>
          <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-xl p-5 space-y-3 text-sm text-gray-400 leading-relaxed">
            <p>
              I believe the best way to build credibility is to be genuinely useful first. This platform
              is the result of real experimentation, real failures, and real learnings — not a polished
              product built for a pitch deck.
            </p>
            <p>
              I'm sharing it freely because I know how painful it is to get started with AI content
              pipelines. The tooling is fragmented, the prompts are opaque, and most tutorials stop at
              "hello world". This platform is my attempt to hand someone a working system — not a
              starting point.
            </p>
            <p>
              If this helps you build something, I only ask that you pay it forward. Build something
              useful, share what you learn, and help the next person who's where you were.
            </p>
            <p className="text-indigo-400 font-medium">
              — Timal
            </p>
          </div>
        </section>

        {/* Tech vision */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-800">
            The bigger picture
          </h2>
          <div className="text-gray-500 text-sm leading-relaxed space-y-3">
            <p>
              This platform is part of a broader vision: making AI-powered content distribution accessible
              to anyone with domain expertise — not just those with large teams or technical backgrounds.
            </p>
            <p>
              The next phase involves expanding to multi-platform publishing, advanced signal scoring,
              and community-contributed prompt libraries. If you want to be part of where this goes,
              reach out.
            </p>
          </div>
        </section>

        <div className="pt-2 text-center text-gray-700 text-xs">
          Built with Claude, Trigger.dev, ElevenLabs, and a lot of late nights in Melbourne.
        </div>
      </div>
    </div>
  );
}
