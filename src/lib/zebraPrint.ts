const BROWSER_PRINT_HTTP = "http://localhost:9100";
const BROWSER_PRINT_HTTPS = "https://localhost:9101";

export interface BrowserPrintDevice {
  uid: string;
  connection: string;
  device_type: string;
  manufacturer: string;
  name: string;
  version: number;
}

async function bpFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BROWSER_PRINT_HTTP}${path}`, init);
  } catch {
    return fetch(`${BROWSER_PRINT_HTTPS}${path}`, init);
  }
}

export async function discoverBrowserPrintDevices(): Promise<BrowserPrintDevice[]> {
  const res = await bpFetch("/available");
  if (!res.ok) throw new Error(`Agent returned ${res.status}`);
  const data: unknown = await res.json();
  const devices = Array.isArray(data)
    ? data
    : (data as Record<string, unknown> | null)?.printer;
  if (!Array.isArray(devices)) return [];
  return devices as BrowserPrintDevice[];
}

export async function sendViaBrowserPrint(
  device: BrowserPrintDevice,
  zpl: string,
): Promise<void> {
  const res = await bpFetch("/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device, data: zpl }),
  });
  if (!res.ok) throw new Error(`Agent write failed: ${res.status}`);
}

export function isConnectionRefused(e: unknown): boolean {
  return e instanceof TypeError && /refused/i.test(e.message);
}

/**
 * Outcome of a direct network-print attempt.
 *
 *  - `responded`: fetch completed with an HTTP response. Rare for raw-socket
 *    printers (port 9100), more typical for print servers / web frontends.
 *  - `no_response`: fetch threw without a connection-refused signal — most
 *    commonly a timeout. For raw-socket Zebra printers this is the *normal*
 *    success case (they read the bytes and never reply with HTTP), but the
 *    same exception is also raised when the host is unreachable. The browser
 *    cannot tell those apart, so the UI must surface this honestly rather
 *    than reporting an unverified success.
 *  - `refused`: TCP RST — host reachable but nothing listening on the port.
 */
export type NetworkPrintResult =
  | { kind: "responded"; status: number }
  | { kind: "no_response" }
  | { kind: "refused" };

/**
 * Direct raw-socket print attempt. Returns a Result rather than throwing
 * because the success and unreachable-host paths raise the same exception
 * (the printer never speaks HTTP back). The Browser-Print helpers above
 * throw because they speak HTTP end-to-end and have no such ambiguity.
 *
 * Chrome shows a Private Network Access permission prompt on first use.
 */
export async function sendViaNetwork(
  ip: string,
  port: number,
  zpl: string,
): Promise<NetworkPrintResult> {
  try {
    const res = await fetch(`http://${ip}:${port}`, {
      method: "POST",
      body: zpl,
      headers: { "Content-Type": "text/plain" },
      signal: AbortSignal.timeout(4000),
    });
    return { kind: "responded", status: res.status };
  } catch (e) {
    if (isConnectionRefused(e)) return { kind: "refused" };
    return { kind: "no_response" };
  }
}
