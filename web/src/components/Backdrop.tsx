export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{
        background: [
          "radial-gradient(1200px 700px at 12% -10%, rgba(91,140,255,0.22), transparent 60%)",
          "radial-gradient(900px 600px at 95% 10%, rgba(167,139,250,0.18), transparent 60%)",
          "radial-gradient(1000px 800px at 50% 120%, rgba(34,211,238,0.10), transparent 60%)",
          "linear-gradient(180deg, #0b0e16, #07080c)",
        ].join(","),
      }}
    >
      <svg className="absolute inset-x-0 bottom-0 h-[70%] w-full opacity-70" viewBox="0 0 1440 600" preserveAspectRatio="none">
        <defs>
          <linearGradient id="dune1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b2233" />
            <stop offset="1" stopColor="#0a0c12" />
          </linearGradient>
          <linearGradient id="dune2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#252d42" />
            <stop offset="1" stopColor="#0a0c12" />
          </linearGradient>
        </defs>
        <path d="M0 260 C 240 180, 480 320, 760 250 S 1200 160, 1440 230 L1440 600 L0 600 Z" fill="url(#dune1)" />
        <path d="M0 400 C 300 330, 620 450, 900 390 S 1260 330, 1440 380 L1440 600 L0 600 Z" fill="url(#dune2)" />
      </svg>
    </div>
  );
}
