/**
 * Optional Stripe Machine Payments Protocol (MPP) alongside x402.
 *
 * INERT until all of these are set (nothing changes otherwise):
 *   STRIPE_SECRET_KEY       restricted key with PaymentIntents write,
 *                           Crypto Deposit Addresses read/write and
 *                           Business Network Profile read
 *   STRIPE_PROFILE_ID       profile_... (Dashboard -> Stripe profile)
 *   TEMPO_DEPOSIT_ADDRESS   from POST /v1/crypto/deposit_addresses network=tempo
 *
 * Optional: MPP_ENABLED=0 to switch off, MPP_HOSTED_FEE_PAYER=0 to stop
 * Stripe sponsoring Tempo gas.
 *
 * Stripe records Tempo payments in whole cents (min $0.01), so MPP prices
 * round up to the cent ($0.005 -> $0.01, $0.025 -> $0.03).
 */
import crypto from "node:crypto";

export const MPP_MIN_USD = 0.01;

export function loadMppConfig(env = process.env) {
  const secretKey = (env.STRIPE_SECRET_KEY || "").trim();
  const profileId = (env.STRIPE_PROFILE_ID || "").trim();
  const tempoDepositAddress = (env.TEMPO_DEPOSIT_ADDRESS || "").trim();
  const off = String(env.MPP_ENABLED || "").trim() === "0";
  return {
    secretKey,
    profileId,
    tempoDepositAddress,
    livemode: secretKey ? !secretKey.includes("_test_") : false,
    hostedFeePayer: String(env.MPP_HOSTED_FEE_PAYER || "").trim() !== "0",
    databaseUrl: (env.DATABASE_URL || "").trim(),
    enabled: !off && Boolean(secretKey && profileId && tempoDepositAddress),
  };
}

/** USD amount string for MPP from an x402 price like "$0.005". */
export function mppAmount(price) {
  const n = Number(String(price || "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return (Math.ceil(Math.max(n, MPP_MIN_USD) * 100 - 1e-9) / 100).toFixed(2);
}

/** Map "GET /path" -> amount for every paid route MPP should cover. */
export function mppRouteAmounts(paidRoutes) {
  const out = {};
  for (const [key, conf] of Object.entries(paidRoutes || {})) {
    const path = key.slice(key.indexOf(" ") + 1);
    const price = conf?.accepts?.[0]?.price;
    const amount = mppAmount(price);
    if (amount) out[`${key.slice(0, key.indexOf(" ")).toUpperCase()} ${path}`] = amount;
  }
  return out;
}

/** Build the mppx server handle. Returns null when inert. */
export async function createMpp(cfg, deps = {}) {
  if (!cfg?.enabled) return null;
  const { Mppx, stripe, Store } = deps.mppx || (await import("mppx/server"));
  const StripeClient = deps.Stripe || (await import("stripe")).default;
  let store = deps.store;
  if (!store) {
    if (cfg.databaseUrl) {
      const pg = await import("pg");
      const Pool = pg.Pool || pg.default?.Pool || pg.default;
      store = Store.postgres(new Pool({ connectionString: cfg.databaseUrl, max: 2 }));
    } else {
      store = Store.memory();
    }
  }
  const client = new StripeClient(cfg.secretKey, { apiVersion: "2026-07-29.preview" });
  const smp = stripe.create({
    client,
    networkId: cfg.profileId,
    livemode: cfg.livemode,
    hostedFeePayer: cfg.livemode && cfg.hostedFeePayer,
    store,
    depositAddresses: { tempo: cfg.tempoDepositAddress },
  });
  const secretKey = crypto.createHmac("sha256", cfg.secretKey).update("mpp-challenge-signing").digest("base64");
  const mppx = Mppx.create({ methods: smp.defaultMethods({ exclude: ["spt"] }), secretKey });
  return { mppx, cfg };
}

function toFetchRequest(req) {
  const proto = req.protocol || "https";
  const url = `${proto}://${req.get("host") || "localhost"}${req.originalUrl || req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  const init = { method: req.method, headers };
  if (!["GET", "HEAD"].includes(req.method) && req.body !== undefined) {
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }
  return new Request(url, init);
}

function hasMppCredential(req) {
  return /^\s*Payment\s+/i.test(String(req.get?.("authorization") || req.headers?.authorization || ""));
}

/**
 * Express middleware. Place before x402.
 * Sets req.mppPaid when an MPP credential verified, so x402 is skipped.
 */
export function mppMiddleware({ mpp, routeAmounts }) {
  if (!mpp) return (_req, _res, next) => next();
  return async (req, res, next) => {
    const amount = routeAmounts[`${req.method.toUpperCase()} ${req.path}`];
    if (!amount) return next();
    let result;
    try {
      result = await mpp.mppx.charge({ amount, description: `${req.method} ${req.path}` })(toFetchRequest(req));
    } catch (e) {
      console.error("mpp charge failed", e?.message || e);
      if (hasMppCredential(req)) {
        return res.status(502).json({ error: "mpp_unavailable", message: "MPP payment could not be verified. Retry or pay with x402." });
      }
      return next();
    }
    if (result.status === 402) {
      const challenge = result.challenge;
      const www = challenge.headers.get("www-authenticate");
      if (hasMppCredential(req)) {
        res.status(402);
        challenge.headers.forEach((v, k) => res.set(k, v));
        return res.send(await challenge.text());
      }
      if (www) {
        const writeHead = res.writeHead;
        res.writeHead = function (...args) {
          if (res.statusCode === 402 || args[0] === 402) {
            const prev = res.getHeader("www-authenticate");
            res.setHeader("www-authenticate", prev ? [].concat(prev, www) : www);
          }
          return writeHead.apply(this, args);
        };
      }
      return next();
    }
    req.mppPaid = true;
    try {
      const receipted = result.withReceipt(new Response(null, { status: 200 }));
      receipted.headers.forEach((v, k) => { if (k !== "content-type" && k !== "content-length") res.set(k, v); });
    } catch { /* receipt header optional */ }
    res.set("X-Paid-Via", "mpp");
    return next();
  };
}

/** Skip x402 when the request already paid via MPP. */
export function skipX402IfMppPaid(middleware) {
  return (req, res, next) => {
    if (req.mppPaid) return next();
    return middleware(req, res, next);
  };
}
