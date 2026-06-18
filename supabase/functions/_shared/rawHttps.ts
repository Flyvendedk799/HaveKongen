// Raw HTTPS GET over Deno.connectTls.
//
// Why this exists: the Dataforsyningen API gateway (Gravitee) returns chunked
// responses and closes the TLS connection without a `close_notify`. Deno's
// fetch() rejects that with "unexpected end of file" (Node/OpenSSL and the
// hosted Supabase edge runtime tolerate it, but the local edge runtime does
// not). Reading the socket directly lets us accept the full body and treat the
// unclean close as end-of-stream. Works for normal Content-Length responses too,
// so it's a safe drop-in for any plain HTTPS GET (Dataforsyningen, Mapbox, …).

export type RawResponse = { status: number; body: Uint8Array; contentType: string };

export async function rawHttpsGet(
  urlStr: string,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
): Promise<RawResponse | null> {
  const url = new URL(urlStr);

  // Non-HTTPS (e.g. local http) — the close_notify quirk doesn't apply; use fetch.
  if (url.protocol !== "https:") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(urlStr, { signal: controller.signal, headers: extraHeaders });
      const body = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, body, contentType: r.headers.get("content-type") ?? "" };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const host = url.hostname;
  const port = url.port ? Number(url.port) : 443;
  const path = `${url.pathname}${url.search}`;
  let conn: Deno.TlsConn | null = null;
  const timer = setTimeout(() => { try { conn?.close(); } catch { /* already closed */ } }, timeoutMs);
  try {
    conn = await Deno.connectTls({ hostname: host, port });
    const headers: Record<string, string> = {
      Host: host,
      "User-Agent": "havekongen",
      Accept: "*/*",
      // No compression — we read raw bytes and don't inflate.
      "Accept-Encoding": "identity",
      Connection: "close",
      ...extraHeaders,
    };
    const headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    await conn.write(new TextEncoder().encode(`GET ${path} HTTP/1.1\r\n${headerLines}\r\n\r\n`));

    const chunks: Uint8Array[] = [];
    const buf = new Uint8Array(65536);
    try {
      while (true) {
        const n = await conn.read(buf);
        if (n === null) break;
        chunks.push(buf.slice(0, n));
      }
    } catch { /* unclean TLS close after the full body — tolerated */ }

    let len = 0;
    for (const c of chunks) len += c.length;
    const all = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return parseHttpResponse(all);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    try { conn?.close(); } catch { /* already closed */ }
  }
}

function parseHttpResponse(all: Uint8Array): RawResponse | null {
  let sep = -1;
  for (let i = 0; i + 3 < all.length; i += 1) {
    if (all[i] === 13 && all[i + 1] === 10 && all[i + 2] === 13 && all[i + 3] === 10) { sep = i; break; }
  }
  if (sep < 0) return null;
  const headerText = new TextDecoder().decode(all.slice(0, sep));
  const rawBody = all.slice(sep + 4);
  const lines = headerText.split("\r\n");
  const status = Number(lines[0]?.match(/HTTP\/\d\.\d\s+(\d{3})/)?.[1] ?? 0);
  let chunked = false;
  let contentType = "";
  for (let i = 1; i < lines.length; i += 1) {
    const idx = lines[i].indexOf(":");
    if (idx <= 0) continue;
    const key = lines[i].slice(0, idx).trim().toLowerCase();
    const value = lines[i].slice(idx + 1).trim();
    if (key === "transfer-encoding" && value.toLowerCase().includes("chunked")) chunked = true;
    if (key === "content-type") contentType = value;
  }
  return { status, body: chunked ? dechunk(rawBody) : rawBody, contentType };
}

function dechunk(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 0;
  while (i < b.length) {
    let j = i;
    while (j + 1 < b.length && !(b[j] === 13 && b[j + 1] === 10)) j += 1;
    const size = parseInt(new TextDecoder().decode(b.slice(i, j)).split(";")[0].trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    i = j + 2;
    parts.push(b.slice(i, i + size));
    i += size + 2;
  }
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function decodeText(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}
