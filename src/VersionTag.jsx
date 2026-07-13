import { bmConfig } from './config.js';

// Subtle build-version footer, shared across every BM app. The app passes its
// `version` to configureBm — typically `v{pkgVersion} · {git short SHA}` injected
// at build time — so it updates automatically on every deploy without manual
// bumping. Renders nothing if no version was configured.
//
//   <VersionTag />                      // centred, muted, tiny
//   <VersionTag className="pb-2" />     // extra spacing
export function VersionTag({ className = '' }) {
  const v = bmConfig().version;
  if (!v) return null;
  return (
    <div
      className={`text-center text-[10px] leading-none tracking-wide text-gray-400/70 py-2 select-none ${className}`}
      title="App build version"
    >
      {v}
    </div>
  );
}
