// Receipt printing — shared by every BM app that prints paper receipts
// (SkulFi, Bisnis Stoa). Import from '@bm/client/print'. TWO transports:
//
//  1. Web Bluetooth ESC/POS (below) — Chrome/Edge/Android, cheap BLE printers.
//  2. System print dialog (printHtmlViaDialog / printMethod at the bottom) —
//     THE Apple path: Safari/iPhone/iPad/Mac have no Web Bluetooth, but they
//     all have AirPrint, and current receipt printers (Star TSP143IV, Epson
//     TM-m30III) support AirPrint natively. Apps render an 80mm-styled HTML
//     receipt and hand it to the device's own dialog. Capability-detect with
//     isBleSupported() — never browser-sniff — so if a future Safari ships
//     Web Bluetooth, transport 1 lights up there automatically.
//
// Targets cheap Chinese 58mm BLE thermal printers (recommended: GOOJPRT
// MTP-II class, ~$12–25/unit). IMPORTANT: Web Bluetooth (navigator.bluetooth)
// only speaks BLE/GATT, never classic Bluetooth SPP — many cheap thermal
// printers are SPP-only (Android-app only) and will simply never appear in the
// device picker. "Supports iOS" in a listing is the reliable proxy for BLE
// support (Apple requires it). Chrome/Edge only (desktop + Android) — NOT
// Safari/iOS.
//
// This module owns the transport (connect / chunked writes / logo rastering)
// and the ESC/POS byte primitives. Receipt LAYOUTS stay in each app — a fee
// receipt and a trade-store docket share a printer, not a design.
//
//   import { connectPrinter, isConnected, printBytes, escpos, rasterImage }
//     from '@bm/client/print';
//
//   const b = [];
//   b.push(...escpos.init(), ...escpos.alignCenter(), ...escpos.bold(true));
//   b.push(...escpos.text('MY SHOP\n'));
//   await printBytes(new Uint8Array(b));   // connects (device picker) if needed
import { bmConfig } from './config.js';

// These printers don't expose a standard GATT printer profile; they use cheap
// UART-passthrough BLE modules. We try the handful of UUID patterns that
// ~cover the market, in order of likelihood for this printer class.
const CANDIDATE_PROFILES = [
  { service: 0xffe0, write: 0xffe1 },   // HM-10 / JDY-08 / CC254x style — most common
  { service: 0xff00, write: 0xff02 },   // alternate module family on some ESC/POS printers
  { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e' }, // Nordic UART
];
const ALL_SERVICES = CANDIDATE_PROFILES.map(p => p.service);

let cached = null; // { device, characteristic }

const lsKey = () => `${bmConfig().app || 'bm'}_printer_name`;

export function isBleSupported() { return typeof navigator !== 'undefined' && !!navigator.bluetooth; }
export function lastConnectedName() { try { return localStorage.getItem(lsKey()); } catch { return null; } }
export function isConnected() { return !!cached?.device?.gatt?.connected; }

// Opens the browser's device picker (must be called from a user gesture — a
// click handler — Web Bluetooth requires this, no silent auto-connect).
export async function connectPrinter() {
  if (!isBleSupported()) throw new Error('This browser does not support Bluetooth printing (use Chrome/Edge, not Safari).');
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: ALL_SERVICES,
  });
  const server = await device.gatt.connect();

  let characteristic = null;
  for (const profile of CANDIDATE_PROFILES) {
    try {
      const service = await server.getPrimaryService(profile.service);
      characteristic = await service.getCharacteristic(profile.write);
      break;
    } catch { /* this printer doesn't use this UUID pair — try the next */ }
  }
  if (!characteristic) {
    device.gatt.disconnect();
    throw new Error('Connected, but could not find a known print service on this device. It may use a different BLE profile.');
  }

  cached = { device, characteristic };
  try { localStorage.setItem(lsKey(), device.name || 'Printer'); } catch { /* ignore */ }
  device.addEventListener('gattserverdisconnected', () => { cached = null; });
  return device.name || 'Printer';
}

export function disconnectPrinter() {
  if (cached?.device?.gatt?.connected) cached.device.gatt.disconnect();
  cached = null;
}

// ── ESC/POS byte primitives (58mm paper = 32 chars / 384 dots per line) ──────
const ESC = 0x1b, GS = 0x1d;
const enc = new TextEncoder();

export const escpos = {
  init: () => [ESC, 0x40],
  alignCenter: () => [ESC, 0x61, 0x01],
  alignLeft: () => [ESC, 0x61, 0x00],
  bold: on => [ESC, 0x45, on ? 1 : 0],
  doubleHeight: on => [GS, 0x21, on ? 0x01 : 0x00],
  doubleBoth: on => [GS, 0x21, on ? 0x11 : 0x00],   // double width+height → 16 chars/line
  feed: (lines = 1) => [ESC, 0x64, lines],
  text: s => [...enc.encode(s)],
  // layout helpers as strings (wrap with escpos.text())
  line: (w = 32) => '-'.repeat(w) + '\n',
  lr: (left, right, w = 32) => {
    const pad = Math.max(1, w - left.length - right.length);
    return left + ' '.repeat(pad) + right + '\n';
  },
};

// Send bytes to the connected printer, connecting first (device picker) if
// needed. BLE writes are unreliable above ~20 bytes without MTU negotiation
// (which browsers don't expose control over) — chunk conservatively with a
// small delay so cheap printer modules don't drop bytes.
export async function printBytes(bytes) {
  if (!cached || !isConnected()) await connectPrinter();
  const { characteristic } = cached;
  const CHUNK = 20;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.slice(i, i + CHUNK);
    if (characteristic.properties.writeWithoutResponse) await characteristic.writeValueWithoutResponse(chunk);
    else await characteristic.writeValue(chunk);
    await new Promise(r => setTimeout(r, 15));
  }
}

// ── Image → 1-bit ESC/POS raster (GS v 0) ────────────────────────────────────
// For logos on receipts. Draws the image on a canvas, luminance-thresholds to
// black/white, packs 8 px/byte MSB-first. Returns null (and caches the miss)
// when the image can't be fetched/decoded, so receipts still print without it.
const rasterCache = new Map(); // `${url}|${maxW}` → Uint8Array | null

export async function rasterImage(url, maxW = 240) {
  const key = `${url}|${maxW}`;
  if (rasterCache.has(key)) return rasterCache.get(key);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('image load failed'));
      i.src = url;
    });
    const w = Math.min(maxW, img.naturalWidth);
    const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // flatten transparency to white
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const rowBytes = Math.ceil(w / 8);
    const bitmap = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < 160) bitmap[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7); // dark px → print
      }
    }
    const out = new Uint8Array([
      GS, 0x76, 0x30, 0x00,
      rowBytes & 0xff, (rowBytes >> 8) & 0xff,
      h & 0xff, (h >> 8) & 0xff,
      ...bitmap,
    ]);
    rasterCache.set(key, out);
    return out;
  } catch {
    rasterCache.set(key, null);
    return null;
  }
}

// ── Transport 2: system print dialog / AirPrint ──────────────────────────────

const methodKey = () => `${bmConfig().app || 'bm'}_print_method`;

// 'bluetooth' | 'system'. Default: bluetooth where Web Bluetooth exists,
// otherwise system (Safari / iPhone / iPad / Mac).
export function printMethod() {
  try {
    const saved = localStorage.getItem(methodKey());
    if (saved === 'bluetooth' || saved === 'system') return saved;
  } catch { /* ignore */ }
  return isBleSupported() ? 'bluetooth' : 'system';
}
export function setPrintMethod(m) {
  try { localStorage.setItem(methodKey(), m); } catch { /* ignore */ }
}

// Print an HTML document through the device's own print dialog via a hidden
// iframe (no popup blockers, page stays put). Style the document with
// `@page { size: 80mm auto; margin: 4mm }` for receipt printers. Resolves once
// handed to the dialog; waits for a logo <img> (if present) first.
export function printHtmlViaDialog(html) {
  return new Promise((resolve, reject) => {
    try {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
      document.body.appendChild(frame);
      const doc = frame.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      const go = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); resolve(); }
        catch (e) { reject(e); }
        finally { setTimeout(() => frame.remove(), 60000); } // keep alive while the dialog is open
      };
      const img = doc.querySelector('img');
      if (img && !img.complete) { img.onload = go; img.onerror = go; setTimeout(go, 2500); }
      else setTimeout(go, 50);
    } catch (e) { reject(e); }
  });
}
