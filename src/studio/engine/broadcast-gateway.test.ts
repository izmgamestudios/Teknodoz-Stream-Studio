import { describe, expect, it } from "vitest";

import {
  BroadcastGateway,
  discoverGateway,
  fieldsFor,
  GatewayError,
  parseGatewayUrl,
  parseRpcBody,
} from "./broadcast-gateway";

const json = (obj: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A fake gateway: answers initialize / tools/list / tools/call like an MCP Streamable-HTTP server. */
function fakeFetch(
  opts: { sse?: boolean; tools?: unknown[]; fail?: boolean } = {},
): typeof fetch & { calls: { method?: string; sid: string | null }[] } {
  const calls: { method?: string; sid: string | null }[] = [];
  const fn = (async (_url: string, init?: RequestInit) => {
    if (opts.fail) throw new TypeError("Failed to fetch");
    const body = JSON.parse(String(init?.body));
    const sid =
      (init?.headers as Record<string, string>)["Mcp-Session-Id"] ?? null;
    calls.push({ method: body.method, sid });
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    let result: unknown = {};
    if (body.method === "initialize")
      result = { protocolVersion: "2025-03-26", capabilities: {} };
    if (body.method === "tools/list") result = { tools: opts.tools ?? [] };
    if (body.method === "tools/call")
      result = {
        content: [
          {
            type: "text",
            text: `ok:${body.params.name}:${JSON.stringify(body.params.arguments)}`,
          },
        ],
      };
    const payload = { jsonrpc: "2.0", id: body.id, result };
    if (opts.sse)
      return new Response(
        `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Mcp-Session-Id": "s1",
          },
        },
      );
    return json(payload, { "Mcp-Session-Id": "s1" });
  }) as typeof fetch & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

describe("gateway url", () => {
  it("accepts loopback only", () => {
    expect(parseGatewayUrl("http://127.0.0.1:18100/gateway").port).toBe(
      "18100",
    );
    expect(parseGatewayUrl("http://localhost:18105/gateway").hostname).toBe(
      "localhost",
    );
    for (const bad of [
      "http://192.168.1.5:18100/gateway",
      "https://evil.example/gateway",
      "ftp://127.0.0.1/x",
      "not a url",
      "",
    ])
      expect(() => parseGatewayUrl(bad)).toThrow(GatewayError);
  });
});

describe("parseRpcBody", () => {
  it("reads JSON and the last valid SSE message", () => {
    expect(parseRpcBody('{"a":1}', "application/json")).toEqual({ a: 1 });
    expect(
      parseRpcBody(
        'event: message\ndata: {"a":1}\n\ndata: {"a":2}\n\n',
        "text/event-stream",
      ),
    ).toEqual({ a: 2 });
    expect(parseRpcBody("", "application/json")).toBeNull();
    expect(() => parseRpcBody("<html>", "application/json")).toThrow(
      GatewayError,
    );
  });
});

describe("BroadcastGateway", () => {
  const tools = [
    {
      name: "set_effect",
      description: "Turn an effect on/off",
      inputSchema: {
        type: "object",
        properties: {
          effect: {
            type: "string",
            enum: ["mic_noise_removal", "studio_voice"],
          },
          enabled: { type: "boolean" },
          strength: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["effect"],
      },
    },
  ];

  it.each([false, true])(
    "connects, keeps the session id and lists tools (sse=%s)",
    async (sse) => {
      const f = fakeFetch({ sse, tools });
      const gw = new BroadcastGateway(
        parseGatewayUrl("http://127.0.0.1:18100/gateway"),
        f,
      );
      const listed = await gw.connect();
      expect(listed.map((t) => t.name)).toEqual(["set_effect"]);
      expect(f.calls.map((c) => c.method)).toEqual([
        "initialize",
        "notifications/initialized",
        "tools/list",
      ]);
      expect(f.calls[2]!.sid).toBe("s1");
      await expect(
        gw.call("set_effect", { effect: "studio_voice", enabled: true }),
      ).resolves.toContain(
        'ok:set_effect:{"effect":"studio_voice","enabled":true}',
      );
    },
  );

  it("reports an unreachable gateway and RPC errors", async () => {
    await expect(
      new BroadcastGateway(
        parseGatewayUrl("http://127.0.0.1:18100/gateway"),
        fakeFetch({ fail: true }),
      ).connect(),
    ).rejects.toMatchObject({ code: "unreachable" });
    const bad = (async () =>
      json({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "nope" },
      })) as unknown as typeof fetch;
    await expect(
      new BroadcastGateway(
        parseGatewayUrl("http://127.0.0.1:18100/gateway"),
        bad,
      ).connect(),
    ).rejects.toMatchObject({ code: "rpc", message: "nope" });
  });

  it("discovers the first port that answers", async () => {
    const seen: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push(url);
      if (!url.includes(":18102/")) throw new TypeError("refused");
      return fakeFetch({ tools })(url, init);
    }) as unknown as typeof fetch;
    const gw = await discoverGateway(undefined, f, 100);
    expect(gw.url.port).toBe("18102");
    expect(
      seen.some((u) => u.includes(":18100/")) &&
        seen.some((u) => u.includes(":18101/")),
    ).toBe(true);
    await expect(
      discoverGateway("http://example.com/x", f),
    ).rejects.toMatchObject({ code: "invalid-url" });
  });
});

describe("fieldsFor", () => {
  it("builds form fields from the schema", () => {
    const f = fieldsFor({
      name: "x",
      inputSchema: {
        properties: {
          effect: { enum: ["a", "b"] },
          enabled: { type: "boolean" },
          strength: { type: "number", minimum: 0, maximum: 1 },
          label: { type: "string" },
        },
        required: ["effect"],
      },
    });
    expect(f.map((x) => [x.name, x.kind, x.required])).toEqual([
      ["effect", "enum", true],
      ["enabled", "boolean", false],
      ["strength", "number", false],
      ["label", "text", false],
    ]);
    expect(f[0]!.initial).toBe("a");
    expect(f[2]).toMatchObject({ min: 0, max: 1 });
    expect(fieldsFor({ name: "y" })).toEqual([]);
  });
});
