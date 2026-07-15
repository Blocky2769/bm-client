// @bm/client/map — shared real map for the BM apps (Leaflet + OSM/CARTO tiles;
// free, no API key; the tile layer is Google/Mapbox-swappable app-side later).
// CONSUMER NOTE: add `optimizeDeps: { include: ['leaflet'] }` to the app's
// vite.config — leaflet is CJS and imported from inside this package, so Vite's
// dev scanner misses it (raw UMD = white screen in dev; builds are unaffected).
// SUBPATH export on purpose: only map-using apps import '@bm/client/map', so
// apps without maps never pull leaflet into their bundle. Peer dep: leaflet.
//
//   <BmMap points={[{ id, lat, lng, pill: 'K950', dark: true }]} onPoint={…} />
//   <BmMap dark points={[{ id, lat, lng, emoji: '💵', color: '#A78BFA', tooltip: 'Mary' }]} />
//   <LocationPicker value={{lat,lng}} onChange={setLoc} />   // tap/drag to place
//
// Point spec: { id, lat, lng, pill?, emoji?, color?, pulse?, tooltip?, dark? }
//   pill  → price-pill marker (Haus Stap style; dark = navy)
//   emoji → coloured dot marker (Konekt style)
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Whole-of-PNG default view — every BM app serves the entire country.
export const PNG_VIEW = { center: [-6.6, 147.0], zoom: 5 };

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
.bm-pin-wrap{background:none;border:none;}
.bm-pin{transform:translate(-50%,-50%);display:inline-block;white-space:nowrap;background:#fff;color:#12233A;border:2px solid #fff;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:800;box-shadow:0 2px 8px rgba(18,35,58,.35);cursor:pointer;}
.bm-pin-dark{background:#12233A;color:#fff;}
.bm-pin-on{outline:2px solid #E07A5F;transform:translate(-50%,-50%) scale(1.12);}
.bm-dot{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;box-shadow:0 0 0 3px rgba(255,255,255,.18),0 0 12px currentColor;font-size:13px;cursor:pointer;}
@keyframes bm-pinpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
.bm-dot-pulse{animation:bm-pinpulse 1.6s infinite;}`;
  document.head.appendChild(s);
}

const TILES = {
  light: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }],
  dark: ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap · © CARTO' }],
};

function iconFor(p, active) {
  if (p.emoji && !p.pill) {
    const color = p.color || '#22D3EE';
    return L.divIcon({
      className: 'bm-pin-wrap', iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<div class="bm-dot ${p.pulse ? 'bm-dot-pulse' : ''}" style="background:${color};color:${color}">${p.emoji}</div>`,
    });
  }
  return L.divIcon({
    className: 'bm-pin-wrap', iconSize: [0, 0],
    html: `<div class="bm-pin ${p.dark ? 'bm-pin-dark' : ''} ${active ? 'bm-pin-on' : ''}">${p.pill ?? ''}</div>`,
  });
}

// The shared map. `fit`: 'points' fits the bounds of all points (falls back to
// the whole-PNG view when empty); 'none' uses center/zoom (or PNG view).
// `refit`: re-fit whenever points change (default fits once).
export function BmMap({
  height, fill = false, className = '',
  center, zoom, dark = false, points = [], onPoint, activeId,
  fit = 'points', refit = false, zoomControl = true, children,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const didFit = useRef(false);

  useEffect(() => {
    injectCss();
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true });
    map.current = m;
    if (center) m.setView([center.lat ?? center[0], center.lng ?? center[1]], zoom ?? 13);
    else m.setView(PNG_VIEW.center, zoom ?? PNG_VIEW.zoom);
    const [url, opts] = TILES[dark ? 'dark' : 'light'];
    L.tileLayer(url, opts).addTo(m);
    if (zoomControl) L.control.zoom({ position: 'bottomright' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    setTimeout(() => m.invalidateSize(), 60);   // containers often size late
    return () => { m.remove(); map.current = null; layer.current = null; didFit.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const pts = points.filter(p => p.lat != null && p.lng != null);
    for (const p of pts) {
      const mk = L.marker([p.lat, p.lng], { icon: iconFor(p, activeId != null && activeId === p.id), riseOnHover: true, zIndexOffset: p.pulse ? 1000 : 0 })
        .on('click', () => onPoint?.(p));
      if (p.tooltip) mk.bindTooltip(p.tooltip, { direction: 'top', offset: [0, -10] });
      mk.addTo(g);
    }
    if (fit === 'points' && pts.length && (refit || !didFit.current)) {
      didFit.current = true;
      if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [34, 34], maxZoom: 13 });
      else m.setView([pts[0].lat, pts[0].lng], 13);
    }
  }, [points, activeId, onPoint, fit, refit]);

  const inner = <div ref={el} className={fill ? 'absolute inset-0 z-0' : 'absolute inset-0'} />;
  if (fill) return inner;
  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`} style={{ height: height ?? 200 }}>
      {inner}
      {children}
    </div>
  );
}

// Tap/drag a marker to register a place's real position (e.g. a guest house at
// listing time). Emits { lat, lng } on every move; "use my location" overlay
// button asks the device. Starts at the whole-PNG view (or the current value).
export function LocationPicker({ value, onChange, height = 220, className = '' }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const [locating, setLocating] = useState(false);
  const cb = useRef(onChange);
  cb.current = onChange;

  const place = (m, lat, lng, pan) => {
    if (!marker.current) {
      marker.current = L.marker([lat, lng], {
        draggable: true,
        icon: L.divIcon({ className: 'bm-pin-wrap', iconSize: [0, 0], html: '<div class="bm-pin bm-pin-dark" style="font-size:14px;padding:4px 10px">📍</div>' }),
      }).addTo(m);
      marker.current.on('dragend', () => { const p = marker.current.getLatLng(); cb.current?.({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }); });
    } else marker.current.setLatLng([lat, lng]);
    if (pan) m.setView([lat, lng], Math.max(m.getZoom(), 14));
    cb.current?.({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) });
  };

  useEffect(() => {
    injectCss();
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true });
    map.current = m;
    const [url, opts] = TILES.light;
    L.tileLayer(url, opts).addTo(m);
    if (value?.lat != null) { m.setView([value.lat, value.lng], 15); place(m, value.lat, value.lng, false); }
    else m.setView(PNG_VIEW.center, PNG_VIEW.zoom);
    m.on('click', e => place(m, e.latlng.lat, e.latlng.lng, false));
    setTimeout(() => m.invalidateSize(), 60);
    return () => { m.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useMyLocation() {
    if (!('geolocation' in navigator) || !map.current) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setLocating(false); place(map.current, pos.coords.latitude, pos.coords.longitude, true); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`} style={{ height }}>
      <div ref={el} className="absolute inset-0 z-0" />
      <button type="button" onClick={useMyLocation}
        className="absolute top-2 left-2 z-[1000] bg-white rounded-full shadow px-2.5 py-1 text-[11px] font-bold"
        style={{ color: '#12233A' }}>
        {locating ? '…' : '📍 Use my location'}
      </button>
    </div>
  );
}
