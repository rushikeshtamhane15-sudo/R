/**
 * bluetoothPrinter — iter-71
 *
 * Web Bluetooth integration for ESC/POS thermal printers. Tested service
 * UUID families covered:
 *   • 000018f0-… (most generic POS-58 / POS-80 printers)
 *   • 0000ffe0-… (HC-05 style adapters)
 *   • 0000ff00-… (Chinese OEM bulk)
 *
 * The receipt is emitted as raw ESC/POS bytes including a native QR
 * (GS ( k command set) so the printer renders the single-use kiosk QR
 * crisp — no client-side rasterisation.
 *
 * Usage:
 *   const printer = await connectBluetoothPrinter();
 *   await printer.printReceipt(order, qrText);
 *
 * Web Bluetooth is NOT supported on iOS Safari. The caller should
 * fall back to window.print() when isBluetoothSupported() returns false.
 */

const LS_KEY = "efc_bt_printer_name_v1";

const KNOWN_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // BLE serial used by some POS-80
];

const KNOWN_CHAR_UUIDS = [
  "00002af1-0000-1000-8000-00805f9b34fb",
  "0000ffe1-0000-1000-8000-00805f9b34fb",
  "0000ff02-0000-1000-8000-00805f9b34fb",
  "49535343-8841-43f4-a8d4-ecbe34729bb3",
];

const BLE_CHUNK = 100; // safe across iOS-Bluefy and Android Chrome

export function isBluetoothSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

export function getLastPrinterName() {
  try { return localStorage.getItem(LS_KEY) || ""; } catch { return ""; }
}

export async function connectBluetoothPrinter() {
  if (!isBluetoothSupported()) {
    throw new Error("Web Bluetooth not supported on this browser. On iOS, install the Bluefy browser. On desktop, use Chrome or Edge.");
  }
  // requestDevice MUST be called inside a user gesture (button click).
  const device = await navigator.bluetooth.requestDevice({
    filters: KNOWN_SERVICES.map((uuid) => ({ services: [uuid] })),
    optionalServices: KNOWN_SERVICES,
  });
  const server = await device.gatt.connect();
  // Walk the discovered services and find the first writable characteristic.
  let writeChar = null;
  for (const svcUuid of KNOWN_SERVICES) {
    let svc;
    try { svc = await server.getPrimaryService(svcUuid); }
    catch { continue; }
    const chars = await svc.getCharacteristics();
    for (const c of chars) {
      if (c.properties.write || c.properties.writeWithoutResponse) {
        if (KNOWN_CHAR_UUIDS.includes(c.uuid) || c.properties.write || c.properties.writeWithoutResponse) {
          writeChar = c;
          break;
        }
      }
    }
    if (writeChar) break;
  }
  if (!writeChar) {
    try { device.gatt.disconnect(); } catch { /* ignore */ }
    throw new Error("No writable ESC/POS characteristic found on this printer. Make sure it's a thermal Bluetooth printer (POS-58 / POS-80 family).");
  }
  try { localStorage.setItem(LS_KEY, device.name || "Bluetooth printer"); } catch { /* ignore */ }

  const writeRaw = async (bytes) => {
    for (let i = 0; i < bytes.length; i += BLE_CHUNK) {
      const slice = bytes.slice(i, i + BLE_CHUNK);
      if (writeChar.properties.writeWithoutResponse) {
        await writeChar.writeValueWithoutResponse(slice);
      } else {
        await writeChar.writeValue(slice);
      }
    }
  };

  return {
    device,
    server,
    name: device.name || "Bluetooth printer",
    writeRaw,
    printReceipt: (order, qrText) => writeRaw(buildReceiptBytes(order, qrText)),
    disconnect: () => { try { device.gatt.disconnect(); } catch { /* ignore */ } },
  };
}

// ---------------------------------------------------------------------------
// ESC/POS byte construction
// ---------------------------------------------------------------------------
function ascii(str) {
  // Very small subset — ESC/POS code page 437 fits ASCII cleanly. We strip
  // anything outside the printable ASCII range to avoid printer glitches.
  const enc = new TextEncoder();
  const cleaned = (str || "").replace(/[^\x20-\x7E\n]/g, "?");
  return enc.encode(cleaned);
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// Native ESC/POS QR command (GS ( k function 165/167/169).
function qrCommands(text) {
  const data = ascii(text);
  const len = data.length + 3;
  const pL = len & 0xff;
  const pH = (len >> 8) & 0xff;
  return concatBytes([
    // Model 2 — most reliable
    new Uint8Array([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    // Module size = 6 dots — readable on 80mm
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    // Error correction level M (49)
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    // Store data
    new Uint8Array([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    data,
    // Print
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
}

function buildReceiptBytes(order, qrText) {
  const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
  const init = new Uint8Array([ESC, 0x40]); // ESC @  initialize
  const alignCenter = new Uint8Array([ESC, 0x61, 0x01]);
  const alignLeft = new Uint8Array([ESC, 0x61, 0x00]);
  const sizeDouble = new Uint8Array([GS, 0x21, 0x11]); // double width+height
  const sizeNormal = new Uint8Array([GS, 0x21, 0x00]);
  const bold = (on) => new Uint8Array([ESC, 0x45, on ? 0x01 : 0x00]);
  const feed = (n) => new Uint8Array([ESC, 0x64, n]);
  const cut = new Uint8Array([GS, 0x56, 0x00]); // full cut (auto-cutter)
  const sep = ascii("-".repeat(32) + "\n");

  const lines = [];
  lines.push(init, alignCenter, sizeDouble, ascii("efoodcare\n"), sizeNormal);
  lines.push(ascii("GHAR SE ACHHA KHANA\n"));
  lines.push(sep, alignLeft);

  const pair = (k, v) => ascii(padBetween(k, v, 32) + "\n");
  lines.push(pair("Order", String(order.order_id || "")));
  lines.push(pair("Date", String(order.date || "")));
  lines.push(pair("Meal", String((order.meal_type || "").toUpperCase())));
  lines.push(pair("Service", String((order.service || "").toUpperCase())));
  if (order.phone) lines.push(pair("Phone", String(order.phone)));
  lines.push(sep);
  // Item line
  const itemText = `${order.qty} x ${(order.menu_text || "").slice(0, 22)}`;
  lines.push(ascii(padBetween(itemText, `Rs ${order.total}`, 32) + "\n"));
  lines.push(pair("Unit", `Rs ${order.unit_price || 0}`));
  lines.push(bold(true), sizeDouble);
  lines.push(ascii(padBetween("TOTAL", `Rs ${order.total}`, 16) + "\n"));
  lines.push(sizeNormal, bold(false), sep);

  lines.push(alignCenter, ascii("SCAN AT COUNTER\n"));
  lines.push(qrCommands(qrText || ""));
  lines.push(ascii("\nSINGLE-USE\n"));
  lines.push(ascii(`${qrText || ""}\n`));
  lines.push(sep);
  lines.push(ascii("Show this QR at counter\nbefore collecting your thali.\n"));
  lines.push(ascii("Thank you for choosing\nefoodcare!\n"));
  lines.push(feed(3), cut);

  return concatBytes(lines);
}

function padBetween(left, right, width) {
  const l = String(left || "");
  const r = String(right || "");
  const pad = Math.max(1, width - l.length - r.length);
  return l + " ".repeat(pad) + r;
}
