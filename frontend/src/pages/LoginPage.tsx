export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-eve-bg">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px]
                        bg-eve-orange/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-[400px] h-[400px]
                        bg-eve-blue/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8 p-8">
        {/* Logo / title */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-wider text-eve-text">
            EVE <span className="text-eve-orange">Industrialist</span>
          </h1>
          <p className="mt-2 text-eve-muted text-sm tracking-widest uppercase">
            Blueprint Profitability Analyzer
          </p>
        </div>

        {/* Card */}
        <div className="bg-eve-surface border border-eve-border rounded-lg p-8
                        flex flex-col items-center gap-6 w-80 shadow-xl">
          <p className="text-eve-text text-sm text-center leading-relaxed">
            Login with your EVE Online account to analyze your blueprints and
            find the most profitable manufacturing opportunities.
          </p>

          <a
            href="/auth/login"
            className="w-full flex items-center justify-center gap-3
                       bg-eve-orange hover:bg-eve-orange/90 active:scale-95
                       text-white font-semibold py-3 px-6 rounded
                       transition-all duration-150 select-none"
          >
            {/* EVE SSO icon placeholder */}
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52
                       2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9
                       15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55
                       0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8
                       3.97-2.1 5.39z"/>
            </svg>
            Login with EVE Online
          </a>

          <p className="text-eve-muted text-xs text-center">
            We only request permission to read your blueprints and skills.
            <br />No wallet access. No trade execution.
          </p>
        </div>

        {/* Feature list */}
        <div className="grid grid-cols-3 gap-4 mt-4">
          {[
            { icon: "📋", label: "All Blueprints" },
            { icon: "📈", label: "Live Prices" },
            { icon: "💰", label: "Profit Ranking" },
          ].map(({ icon, label }) => (
            <div
              key={label}
              className="bg-eve-surface border border-eve-border rounded p-3
                         text-center text-xs text-eve-muted"
            >
              <div className="text-2xl mb-1">{icon}</div>
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
