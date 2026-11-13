/**
 * Minimal x402 v2 seller: one paywalled route (GET /hello) on Base, with
 * optional Solana (PayAI) and optional Stripe MPP (Tempo USDC).
 *
 * Docs: https://docs.x402.org/getting-started/quickstart-for-sellers
 */
import { loadConfig } from "./config.js";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { loadPayaiConfig, buildPayaiClient, withPayaiMirror, addSolanaAccepts, SOLANA_MAINNET } from "./payai.js";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import { loadMppConfig, createMpp, mppMiddleware, mppRouteAmounts, skipX402IfMppPaid } from "./mpp.js";
import { pathToFileURL } from "node:url";

async function buildFacilitatorClient(cfg) {
  if (cfg.facilitatorKind === "cdp") {
    const { createCdpFacilitatorClient } = await import("@coinbase/cdp-sdk/x402");
    return createCdpFacilitatorClient({
      apiKeyId: process.env.CDP_API_KEY_ID,
      apiKeySecret: process.env.CDP_API_KEY_SECRET,
    });
  }
  return new HTTPFacilitatorClient({ url: cfg.facilitatorUrl });
}

export async function createApp(options = {}) {
  const cfg = options.cfg || loadConfig();
  const payaiCfg = options.payai || loadPayaiConfig();
  const payaiClient = options.payaiClient !== undefined ? options.payaiClient : await buildPayaiClient(payaiCfg);
  const facilitatorClient = withPayaiMirror(await buildFacilitatorClient(cfg), payaiClient, payaiCfg);
  const facilitatorClients = payaiClient ? [facilitatorClient, payaiClient] : facilitatorClient;

  const resourceServer = new x402ResourceServer(facilitatorClients)
    .register(cfg.NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  if (payaiCfg.solanaEnabled) resourceServer.register(SOLANA_MAINNET, new ExactSvmScheme());

  const routeAccepts = {
    scheme: "exact",
    price: cfg.PRICE,
    network: cfg.NETWORK,
    payTo: cfg.PAYTO,
  };

  const paidRoutes = {
    "GET /hello": {
      accepts: [routeAccepts],
      description: "Example paid route. Replace this with your own API.",
      mimeType: "application/json",
      serviceName: cfg.serviceName,
      tags: ["x402", "example"],
    },
  };
  addSolanaAccepts(paidRoutes, payaiCfg);

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));

  // Directories that read accepts[] from the 402 JSON body (v1 style), not only the header.
  app.use((req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 402 && body && body.error === "Payment required") {
        const pr = res.getHeader("payment-required") || res.getHeader("PAYMENT-REQUIRED");
        if (pr) {
          try {
            const decoded = JSON.parse(Buffer.from(String(pr), "base64").toString("utf8"));
            body = { ...decoded, error: body.error };
          } catch {
            /* keep original body */
          }
        }
      }
      return origJson(body);
    };
    next();
  });

  const mppCfg = options.mppConfig || loadMppConfig();
  const mpp = options.mpp !== undefined ? options.mpp : await createMpp(mppCfg);
  const mppAmounts = mppRouteAmounts(paidRoutes);
  app.use(mppMiddleware({ mpp, routeAmounts: mppAmounts }));

  const paywall = createPaywall().withNetwork(evmPaywall).withConfig({
    appName: cfg.serviceName,
    testnet: cfg.net.isTestnet,
  }).build();
  const paywallConfig = { appName: cfg.serviceName, testnet: cfg.net.isTestnet };
  app.use(skipX402IfMppPaid(paymentMiddleware(paidRoutes, resourceServer, paywallConfig, paywall)));

  const base = (cfg.publicBaseUrl || `http://${cfg.HOST === "0.0.0.0" ? "localhost" : cfg.HOST}:${cfg.PORT}`).replace(/\/$/, "");

  app.get("/", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(cfg.serviceName)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.5}
code,pre{font-family:ui-monospace,Menlo,monospace}pre{background:#0b1020;color:#e8eefc;padding:1rem;border-radius:8px;overflow:auto}
a{color:#2563eb}</style></head>
<body>
<h1>${escapeHtml(cfg.serviceName)}</h1>
<p>This is the <a href="https://github.com/gdietsch/x402-setup-kit">x402 setup kit</a> running in
<strong>${cfg.net.isTestnet ? "testnet" : "mainnet"}</strong> on ${escapeHtml(cfg.net.name)} (${escapeHtml(cfg.NETWORK)}).
Paid route: <code>GET /hello</code> at <code>${escapeHtml(cfg.PRICE)}</code> USDC.</p>
<pre>curl -i ${escapeHtml(base)}/hello
# expect HTTP 402 Payment Required</pre>
<p>Free discovery files: <a href="/health">/health</a> · <a href="/openapi.json">/openapi.json</a> ·
<a href="/.well-known/x402">/.well-known/x402</a> · <a href="/llms.txt">/llms.txt</a></p>
<p>Need a review or a done-for-you setup?
<a href="https://signals.incomefather.com/setup">x402 setup service</a>.</p>
</body></html>`);
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: cfg.serviceName,
      network: cfg.NETWORK,
      payTo: cfg.PAYTO,
      facilitator: cfg.facilitatorKind,
      facilitatorUrl: cfg.facilitatorUrl,
      solana: payaiCfg.solanaEnabled,
      mpp: { enabled: Boolean(mpp), methods: mpp ? ["tempo"] : [] },
    });
  });

  app.get("/openapi.json", (_req, res) => {
    res.json({
      openapi: "3.1.0",
      info: {
        title: cfg.serviceName,
        version: "0.1.0",
        description: `Example x402 v2 API. Pay per call in USDC on ${cfg.net.name}${payaiCfg.solanaEnabled ? " or Solana" : ""}.`,
      },
      servers: [{ url: base }],
      paths: {
        "/hello": {
          get: {
            summary: "Example paid route",
            description: `Returns a short JSON greeting after x402 settlement. Price ${cfg.PRICE} USDC.`,
            "x-402": { price: cfg.PRICE, networks: [cfg.NETWORK, ...(payaiCfg.solanaEnabled ? [SOLANA_MAINNET] : [])] },
            responses: {
              200: { description: "Paid response" },
              402: { description: "Payment Required (x402 v2 PAYMENT-REQUIRED header)" },
            },
          },
        },
      },
    });
  });

  app.get("/.well-known/x402", (_req, res) => {
    res.json({
      x402Version: 2,
      instructions: `${cfg.serviceName} — x402 v2 exact scheme, USDC on ${cfg.net.name}${payaiCfg.solanaEnabled ? " or Solana" : ""}. Unpaid calls to /hello return 402 with PAYMENT-REQUIRED.`,
      accepts: [
        { network: cfg.NETWORK, asset: "USDC", payTo: cfg.PAYTO },
        ...(payaiCfg.solanaEnabled ? [{ network: SOLANA_MAINNET, asset: "USDC", payTo: payaiCfg.solanaPayTo }] : []),
      ],
    });
  });

  app.get("/llms.txt", (_req, res) => {
    res.type("text/plain; charset=utf-8").send(`# ${cfg.serviceName}

> Example API that charges per call over x402 (USDC on ${cfg.net.name}${payaiCfg.solanaEnabled ? " or Solana" : ""}).

## Access

- Pay per call (x402 v2, exact scheme): an unpaid request to a paid route returns HTTP 402 with a PAYMENT-REQUIRED header. Sign and retry with PAYMENT-SIGNATURE. Failed calls (4xx/5xx) are never settled.
${mpp ? "- Pay per call (Stripe MPP, Tempo USDC): the same 402 also includes a WWW-Authenticate: Payment challenge with method=\"tempo\". Retry with Authorization: Payment ....\n" : ""}
## Routes

- GET ${base}/hello (${cfg.PRICE}): example paid greeting. Replace this with your own route.

## Machine-readable

- OpenAPI: ${base}/openapi.json
- x402 discovery: ${base}/.well-known/x402
- Health: ${base}/health

Built with the free x402 setup kit: https://github.com/gdietsch/x402-setup-kit
`);
  });

  app.get("/hello", (req, res) => {
    res.json({
      ok: true,
      message: "payment received",
      service: cfg.serviceName,
      paidVia: req.mppPaid ? "mpp" : "x402",
    });
  });

  return app;
}

function escapeHtml(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = loadConfig();
  const app = await createApp({ cfg });
  app.listen(cfg.PORT, cfg.HOST, () => {
    console.log(`${cfg.serviceName} listening on http://${cfg.HOST}:${cfg.PORT}`);
    console.log(`network=${cfg.net.name} (${cfg.NETWORK})`);
    console.log(`payTo=${cfg.PAYTO}`);
    console.log(`facilitator=${cfg.facilitatorKind} ${cfg.facilitatorUrl}`);
    console.log(`try: curl -i http://localhost:${cfg.PORT}/hello`);
  });
}
