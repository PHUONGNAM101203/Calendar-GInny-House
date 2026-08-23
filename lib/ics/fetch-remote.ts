// Server-side fetch of a user-supplied .ics URL.
//
// This is the app's only outbound request to a host the user chooses, which
// makes it its only SSRF surface: without the checks below, pasting
// http://169.254.169.254/... or http://10.0.0.5/ would have the server read
// something on its own network and hand the body back through the import
// preview. So every hop is resolved to an IP and rejected unless that IP is
// public, redirects are followed manually so a public host cannot bounce us
// onto a private one, and the body is capped and timed out.
import { lookup } from "node:dns/promises";

export type RemoteIcsResult = { ok: true; text: string } | { ok: false; error: string };

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. the cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function isBlockedIpv6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];
  if (value === "::1" || value === "::") return true;
  // IPv4-mapped (::ffff:10.0.0.1) would otherwise slip past the v4 rules.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return (
    value.startsWith("fc") || // unique local
    value.startsWith("fd") ||
    /^fe[89ab]/.test(value) // link-local
  );
}

async function resolvesToPublicAddress(hostname: string): Promise<boolean> {
  try {
    // all:true so a host answering with several records cannot hide a private
    // one behind a public first answer.
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every(({ address, family }) =>
      family === 6 ? !isBlockedIpv6(address) : !isBlockedIpv4(address)
    );
  } catch {
    return false;
  }
}

// webcal:// is what Google and Outlook hand out for calendar subscriptions; it
// is plain HTTPS wearing a different scheme label.
function normaliseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim().replace(/^webcal:\/\//i, "https://"));
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function readCapped(response: Response): Promise<string | null> {
  // Content-Length is a hint the server may omit or lie about, so the stream
  // is counted as it arrives rather than trusted up front.
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(joined);
}

export async function fetchRemoteIcs(rawUrl: string): Promise<RemoteIcsResult> {
  const initial = normaliseUrl(rawUrl);
  if (!initial) {
    return { ok: false, error: "Đường dẫn không hợp lệ. Chỉ hỗ trợ http, https và webcal." };
  }
  // Annotated rather than inferred: the redirect loop below reassigns this, so
  // inference would widen it back to `URL | null` and lose the check above.
  let target: URL = initial;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!(await resolvesToPublicAddress(target.hostname))) {
        return { ok: false, error: "Đường dẫn này trỏ tới địa chỉ nội bộ nên không được phép." };
      }

      const response = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8" },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        const next = location ? normaliseUrl(new URL(location, target).toString()) : null;
        if (!next) return { ok: false, error: "Đường dẫn chuyển hướng không hợp lệ." };
        target = next;
        continue;
      }

      if (!response.ok) {
        return { ok: false, error: `Không tải được lịch (máy chủ trả về ${response.status}).` };
      }

      const text = await readCapped(response);
      if (text === null) return { ok: false, error: "File lịch quá lớn (tối đa 5MB)." };
      return { ok: true, text };
    }

    return { ok: false, error: "Đường dẫn chuyển hướng quá nhiều lần." };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Tải lịch quá lâu, vui lòng thử lại." };
    }
    console.error("[ics] remote fetch failed", error);
    return { ok: false, error: "Không kết nối được tới đường dẫn này." };
  } finally {
    clearTimeout(timer);
  }
}
