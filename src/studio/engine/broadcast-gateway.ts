// src/studio/engine/broadcast-gateway.ts
// Minimal MCP (Streamable HTTP, JSON-RPC 2.0) client for the local NVIDIA Broadcast gateway.
// Broadcast 2.3+ serves MCP on loopback, default http://127.0.0.1:18100/gateway (ports 18100-18109,
// no key). Tool names are NOT hard-coded: the gateway advertises its live effect list, so the UI
// renders whatever `tools/list` returns. Loopback hosts only; every call is user initiated.

export const GATEWAY_PORTS = [
  18100, 18101, 18102, 18103, 18104, 18105, 18106, 18107, 18108, 18109,
] as const;
export const DEFAULT_GATEWAY = "http://127.0.0.1:18100/gateway";
const PROTOCOL = "2025-03-26";

export interface ToolSchema {
  type?: string;
  properties?: Record<
    string,
    {
      type?: string;
      description?: string;
      enum?: unknown[];
      default?: unknown;
      minimum?: number;
      maximum?: number;
    }
  >;
  required?: string[];
}
export interface GatewayTool {
  name: string;
  description?: string;
  inputSchema?: ToolSchema;
}

export class GatewayError extends Error {
  constructor(
    readonly code: "invalid-url" | "unreachable" | "http" | "protocol" | "rpc",
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

/** Only loopback endpoints are accepted (the gateway never leaves the machine). */
export function parseGatewayUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new GatewayError("invalid-url", "Geçersiz adres.");
  }
  const loop = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (!loop || (u.protocol !== "http:" && u.protocol !== "https:"))
    throw new GatewayError(
      "invalid-url",
      "Yalnızca yerel (127.0.0.1 / localhost) adreslere bağlanılır.",
    );
  return u;
}

/** Reads the JSON-RPC payload from either a JSON body or an SSE stream (`data:` lines). */
export function parseRpcBody(text: string, contentType: string): unknown {
  if (/text\/event-stream/i.test(contentType)) {
    let last: unknown = null;
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        last = JSON.parse(data);
      } catch {
        /* keep the last valid message */
      }
    }
    return last;
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new GatewayError("protocol", "Gateway beklenmeyen bir yanıt verdi.");
  }
}

export class BroadcastGateway {
  private id = 0;
  private session: string | null = null;
  tools: GatewayTool[] = [];

  constructor(
    readonly url: URL,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly timeoutMs = 4000,
  ) {}

  private async post(body: Record<string, unknown>): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(this.url.toString(), {
        method: "POST",
        signal: ctl.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new GatewayError("unreachable", "Gateway'e ulaşılamadı.");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok && res.status !== 202)
      throw new GatewayError("http", `Gateway ${res.status} döndürdü.`);
    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) this.session = sid;
    return parseRpcBody(
      await res.text(),
      res.headers.get("Content-Type") ?? "",
    );
  }

  private async rpc<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const id = ++this.id;
    const msg = (await this.post({
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    })) as {
      result?: T;
      error?: { message?: string };
    } | null;
    if (!msg) throw new GatewayError("protocol", "Boş yanıt.");
    if (msg.error)
      throw new GatewayError("rpc", msg.error.message ?? "Gateway hatası.");
    return msg.result as T;
  }

  /** initialize -> initialized -> tools/list. Resolves with the advertised tools. */
  async connect(): Promise<GatewayTool[]> {
    await this.rpc("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "teknodoz-studio", version: "1.0" },
    });
    await this.post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }).catch(() => undefined);
    const r = await this.rpc<{ tools?: GatewayTool[] }>("tools/list");
    this.tools = (r.tools ?? []).filter((t) => typeof t?.name === "string");
    return this.tools;
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.rpc<{
      content?: { type: string; text?: string }[];
      isError?: boolean;
    }>("tools/call", { name, arguments: args });
    const text = (r.content ?? [])
      .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`))
      .join("\n");
    if (r.isError) throw new GatewayError("rpc", text || "Araç hata döndürdü.");
    return text || "Tamam.";
  }
}

/** Tries the given URL, or every default port, and returns the first gateway that answers. */
export async function discoverGateway(
  explicit?: string,
  fetchFn?: typeof fetch,
  timeoutMs = 1500,
): Promise<BroadcastGateway> {
  const urls = explicit?.trim()
    ? [parseGatewayUrl(explicit)]
    : GATEWAY_PORTS.map((p) =>
        parseGatewayUrl(`http://127.0.0.1:${p}/gateway`),
      );
  let last: unknown = new GatewayError("unreachable", "Gateway bulunamadı.");
  for (const u of urls) {
    const gw = new BroadcastGateway(u, fetchFn, timeoutMs);
    try {
      await gw.connect();
      return gw;
    } catch (e) {
      last = e;
      if (
        e instanceof GatewayError &&
        (e.code === "rpc" || e.code === "protocol")
      )
        break; // something answered
    }
  }
  throw last;
}

/** Form fields for a tool's arguments, derived from its JSON schema. */
export interface ArgField {
  name: string;
  kind: "boolean" | "number" | "enum" | "text";
  label: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  initial: unknown;
}

export function fieldsFor(tool: GatewayTool): ArgField[] {
  const props = tool.inputSchema?.properties ?? {};
  const req = new Set(tool.inputSchema?.required ?? []);
  return Object.entries(props).map(([name, p]): ArgField => {
    const base = {
      name,
      label: p.description ? `${name}: ${p.description}` : name,
      required: req.has(name),
    };
    if (Array.isArray(p.enum) && p.enum.length)
      return {
        ...base,
        kind: "enum",
        options: p.enum.map(String),
        initial: p.default ?? String(p.enum[0]),
      };
    if (p.type === "boolean")
      return { ...base, kind: "boolean", initial: p.default ?? false };
    if (p.type === "number" || p.type === "integer")
      return {
        ...base,
        kind: "number",
        ...(p.minimum !== undefined ? { min: p.minimum } : {}),
        ...(p.maximum !== undefined ? { max: p.maximum } : {}),
        initial: p.default ?? p.minimum ?? 0,
      };
    return { ...base, kind: "text", initial: p.default ?? "" };
  });
}
