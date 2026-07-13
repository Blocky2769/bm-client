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
  // Colour is set inline (muted grey that reads on both light and dark footers)
  // so it never depends on the host app scanning this package for Tailwind classes.
  return (
    <div
      className={`text-center leading-none tracking-wide py-2 select-none ${className}`}
      style={{ color: '#9ca3af', fontSize: '10px' }}
      title="App build version"
    >
      {v}
    </div>
  );
}
