import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { loadPayaiConfig, SOLANA_MAINNET } from "../src/payai.js";

const PAYTO = "0x0000000000000000000000000000000000000001";
// A valid-looking Solana address (System Program) used only to advertise Solana accepts.
const SOLANA_PAY_TO = "11111111111111111111111111111111";

function testEnv(extra = {}) {
  return {
    PAYTO_ADDRESS: PAYTO,
    NETWORK: "eip155:84532",
    FACILITATOR: "url",
    FACILITATOR_URL: "https://facilitator.payai.network",
    PRICE: "$0.01",
    SERVICE_NAME: "Setup Kit Test",
    PUBLIC_BASE_URL: "http://127.0.0.1",
    PAYAI_ENABLED: "1",
    SOLANA_PAY_TO,
    MPP_ENABLED: "0",
    ...extra,
  };
}

async function withServer(env, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  try {
    const cfg = loadConfig(env);
    const payai = loadPayaiConfig(env);
    const app = await createApp({ cfg, payai, mpp: null });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      await fn(url);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  }
}

function decodePaymentRequired(res) {
  const hdr = res.headers.get("payment-required") || res.headers.get("PAYMENT-REQUIRED");
  assert.ok(hdr, "missing PAYMENT-REQUIRED header");
  return JSON.parse(Buffer.from(String(hdr), "base64").toString("utf8"));
}

test("GET /hello unpaid returns a valid x402 v2 402 on Base and Solana", async () => {
  await withServer(testEnv(), async (url) => {
    const res = await fetch(`${url}/hello`, { headers: { accept: "application/json" } });
    assert.equal(res.status, 402);
    const body = decodePaymentRequired(res);
    const accepts = body.accepts || [];
    assert.ok(accepts.length >= 2, `expected Base + Solana accepts, got ${accepts.length}`);
    const base = accepts.find((a) => a.network === "eip155:84532");
    const sol = accepts.find((a) => a.network === SOLANA_MAINNET);
    assert.ok(base, "missing Base accept");
    assert.ok(sol, "missing Solana accept");
    assert.equal(String(base.amount), "10000"); // $0.01 USDC (6 decimals)
    assert.equal(base.payTo?.toLowerCase(), PAYTO.toLowerCase());
    assert.equal(sol.payTo, SOLANA_PAY_TO);
    const json = await res.json();
    assert.equal(json.error, "Payment required");
  });
});

test("free discovery routes return 200 and do not mention forbidden markets", async () => {
  const FORBIDDEN = /kalshi|prediction[- ]market|btc15|eth15/i;
  await withServer(testEnv(), async (url) => {
    for (const path of ["/", "/health", "/openapi.json", "/.well-known/x402", "/llms.txt"]) {
      const res = await fetch(url + path);
      assert.equal(res.status, 200, path);
      const text = await res.text();
      assert.doesNotMatch(text, FORBIDDEN, path);
    }
    const health = await (await fetch(url + "/health")).json();
    assert.equal(health.ok, true);
    assert.equal(health.payTo, PAYTO);
    assert.equal(health.network, "eip155:84532");
  });
});
