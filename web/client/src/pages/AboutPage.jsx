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
    <svg
      className="w-4 h-4"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export default function AboutPage() {
  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">
          About the Creator
        </h1>
      </div>

      <div className="space-y-8">
        {/* Creator card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl select-none">
              T
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg">
                Timal Pathirana
              </h2>
              <p className="text-gray-500 text-sm">
                Software Engineer · AI & Automation Enthusiast
              </p>
            </div>
          </div>
          <p className="text-gray-400 text-sm leading-relaxed mb-4">
            I'm a software engineer based in Melbourne who enjoys building
            AI-powered tools, automated workflows, and systems that solve
            practical problems in creative ways. My background spans both
            engineering and product, and I’m especially interested in using AI
            to build systems that can think, organise information, and operate
            with minimal human intervention.
          </p>
          <div className="flex flex-wrap gap-4">
            <SocialLink
              href="https://www.linkedin.com/in/timalpathirana/"
              label="LinkedIn"
              icon={<LinkedInIcon />}
            />
          </div>
        </div>

        {/* Why it's free */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-800">
            Why it's free
          </h2>
          <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-xl p-5 space-y-3 text-sm text-gray-400 leading-relaxed">
            <p>
              This project started as an experiment to explore what AI-assisted
              systems can actually look like beyond simple demos and tutorials.
            </p>
            <p>
              Over the past week, I spent time designing and building this
              pipeline to better understand how LLMs, automation, content
              generation, and system design can work together in a practical
              way. A big part of the process was experimenting, failing,
              rebuilding parts of the workflow, and slowly improving the quality
              of the outputs.
            </p>
            <p>
              I decided to open source it because I think more people should be
              able to see what’s possible when creativity, engineering, and AI
              come together. My hope is that this project helps someone learn
              faster, build something useful, or even inspires a new idea of
              their own.
            </p>
            <p>
              If you end up building on top of it, improving it, or taking it in
              a completely different direction, that would honestly make the
              project even more meaningful.
            </p>
            <p className="text-indigo-400 font-medium">— Timal</p>
          </div>
        </section>

        <div className="pt-2 text-center text-gray-700 text-xs">
          Built with Claude, OpenAI, ElevenLabs, and a lot of late nights in
          Melbourne.
        </div>
      </div>
    </div>
  );
}
