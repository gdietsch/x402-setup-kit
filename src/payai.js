/**
 * PayAI as a second x402 facilitator (https://docs.payai.network).
 *
 * - Base keeps settling through the primary facilitator (CDP on mainnet).
 *   x402ResourceServer gives earlier clients precedence per network/scheme, and
 *   falls back to PayAI automatically if the primary fails to initialize.
 * - Solana mainnet USDC settles through PayAI. It is only advertised when
 *   SOLANA_PAY_TO is set to a Solana address that already has a USDC token account.
 * - Bazaar mirror: after a successful primary verify on Base, the same payment
 *   payload is sent to PayAI /verify (moves no funds) so PayAI's Bazaar catalogs
 *   the route. Disable with PAYAI_MIRROR_VERIFY=0. Fire-and-forget; never blocks
 *   or alters the real payment.
 */
import { HTTPFacilitatorClient } from "@x402/core/server";

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const PAYAI_DEFAULT_URL = "https://facilitator.payai.network";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function loadPayaiConfig(env = process.env) {
  const enabled = !["0", "false", "off"].includes(String(env.PAYAI_ENABLED ?? "1").toLowerCase());
  const url = (env.PAYAI_FACILITATOR_URL || PAYAI_DEFAULT_URL).replace(/\/$/, "");
  const solanaPayTo = (env.SOLANA_PAY_TO || "").trim();
  if (solanaPayTo && !BASE58.test(solanaPayTo)) {
    throw new Error("SOLANA_PAY_TO must be a base58 Solana address");
  }
  const mirrorVerify = enabled && !["0", "false", "off"].includes(String(env.PAYAI_MIRROR_VERIFY ?? "1").toLowerCase());
  return {
    enabled,
    url,
    solanaPayTo: enabled ? solanaPayTo : "",
    solanaEnabled: enabled && Boolean(solanaPayTo),
    mirrorVerify,
    mirrorExclude: (env.PAYAI_MIRROR_EXCLUDE || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export async function buildPayaiClient(pcfg) {
  if (!pcfg.enabled) return null;
  if (process.env.PAYAI_API_KEY_ID && process.env.PAYAI_API_KEY_SECRET) {
    try {
      const mod = await import("@payai/facilitator");
      return new HTTPFacilitatorClient(mod.facilitator);
    } catch (e) {
      console.warn("payai: @payai/facilitator unavailable, using public endpoint:", e?.message || e);
    }
  }
  return new HTTPFacilitatorClient({ url: pcfg.url });
}

/** Wrap the primary client so successful verifies are mirrored to PayAI for Bazaar cataloging. */
export function withPayaiMirror(primary, payai, pcfg) {
  if (!primary || !payai || !pcfg.mirrorVerify) return primary;
  const origVerify = primary.verify.bind(primary);
  primary.verify = async (paymentPayload, requirements) => {
    const result = await origVerify(paymentPayload, requirements);
    try {
      const url = String(paymentPayload?.resource?.url || "");
      const skip = !result?.isValid || !String(requirements?.network || "").startsWith("eip155:") ||
        pcfg.mirrorExclude.some((s) => url.includes(s));
      if (!skip) {
        payai.verify(paymentPayload, requirements).catch(() => {});
      }
    } catch {
      /* never affect the real payment */
    }
    return result;
  };
  return primary;
}

/** Solana accept entry for a route price like "$0.01" (ExactSvmScheme resolves USDC). */
export function solanaAccept(pcfg, price) {
  return { scheme: "exact", price, network: SOLANA_MAINNET, payTo: pcfg.solanaPayTo };
}

/** Add a Solana option to every route's accepts, except excluded paths. */
export function addSolanaAccepts(routes, pcfg, exclude = []) {
  if (!pcfg.solanaEnabled) return routes;
  for (const [key, route] of Object.entries(routes)) {
    if (exclude.some((s) => key.includes(s))) continue;
    const accepts = Array.isArray(route.accepts) ? route.accepts : [route.accepts];
    const price = accepts[0]?.price;
    if (!price || accepts.some((a) => a.network === SOLANA_MAINNET)) continue;
    route.accepts = [...accepts, solanaAccept(pcfg, price)];
  }
  return routes;
}
