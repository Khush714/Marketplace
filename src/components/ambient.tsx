/** Ambient background environment — morphing aurora blobs, layered glows, film grain. */
export function Ambient() {
  return (
    <div aria-hidden className="grain pointer-events-none fixed inset-0 overflow-hidden">
      {/* base vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,#12101a_0%,#07070a_55%,#050506_100%)]" />

      {/* morphing aurora field */}
      <div className="animate-morph animate-aurora absolute -top-56 left-[8%] h-[560px] w-[720px] bg-[radial-gradient(closest-side,rgba(255,110,60,0.20),transparent_72%)] mix-blend-screen blur-3xl" />
      <div
        className="animate-morph animate-aurora absolute -left-52 top-[26%] h-[520px] w-[520px] bg-[radial-gradient(closest-side,rgba(255,90,60,0.13),transparent_72%)] mix-blend-screen blur-3xl"
        style={{ animationDelay: "-6s, -9s", animationDuration: "31s, 21s" }}
      />
      <div
        className="animate-morph animate-aurora absolute -right-56 top-[48%] h-[560px] w-[560px] bg-[radial-gradient(closest-side,rgba(150,110,255,0.12),transparent_72%)] mix-blend-screen blur-3xl"
        style={{ animationDelay: "-11s, -4s", animationDuration: "37s, 26s" }}
      />
      <div
        className="animate-morph animate-aurora absolute -bottom-64 left-[26%] h-[500px] w-[680px] bg-[radial-gradient(closest-side,rgba(255,158,67,0.11),transparent_72%)] mix-blend-screen blur-3xl"
        style={{ animationDelay: "-3s, -14s", animationDuration: "29s, 24s" }}
      />

      {/* slow drifting accents */}
      <div className="animate-drift absolute left-[14%] top-[10%] h-40 w-40 rounded-full bg-[radial-gradient(closest-side,rgba(255,178,94,0.12),transparent_70%)] blur-2xl" />
      <div
        className="animate-drift absolute right-[18%] top-[34%] h-32 w-32 rounded-full bg-[radial-gradient(closest-side,rgba(196,161,255,0.10),transparent_70%)] blur-2xl"
        style={{ animationDelay: "-8s" }}
      />
    </div>
  );
}
