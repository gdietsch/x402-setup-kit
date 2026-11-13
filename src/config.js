/**
 * Network / facilitator / asset config. TESTNET (Base Sepolia) by default.
 * Mainnet: NETWORK=eip155:8453 + CDP_API_KEY_ID/SECRET (or FACILITATOR_URL).
 */
import "dotenv/config";

export const NETWORKS = {
  "eip155:84532": {
    id: "eip155:84532",
    name: "Base Sepolia",
    isTestnet: true,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorerTx: (hash) => `https://sepolia.basescan.org/tx/${hash}`,
    defaultFacilitatorUrl: "https://facilitator.payai.network",
  },
  "eip155:8453": {
    id: "eip155:8453",
    name: "Base",
    isTestnet: false,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorerTx: (hash) => `https://basescan.org/tx/${hash}`,
    defaultFacilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402",
  },
};

export const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

/**
 * Resolve facilitator:
 * - FACILITATOR=cdp → CDP JWT client (needs CDP_API_KEY_ID + CDP_API_KEY_SECRET)
 * - FACILITATOR=url → plain HTTPFacilitatorClient(FACILITATOR_URL or network default)
 * - FACILITATOR=auto (default):
 *     mainnet → CDP if keys present, else FACILITATOR_URL if set, else error
 *     testnet → FACILITATOR_URL or PayAI (no CDP required)
 */
export function loadConfig(env = process.env) {
  const PORT = Number(env.PORT || 4021);
  const HOST = env.HOST || "0.0.0.0";
  const PRICE = env.PRICE || "$0.01";
  const PAYTO = env.PAYTO_ADDRESS || env.PAY_TO;
  const NETWORK = env.NETWORK || "eip155:84532";
  const net = NETWORKS[NETWORK];
  if (!net) {
    throw new Error(
      `Unsupported NETWORK=${NETWORK}. Use eip155:84532 (Base Sepolia) or eip155:8453 (Base mainnet).`,
    );
  }
  if (!PAYTO || !PAYTO.startsWith("0x") || PAYTO.length !== 42) {
    throw new Error("PAYTO_ADDRESS (or PAY_TO) must be a 0x… EVM address");
  }

  const cdpKeyId = env.CDP_API_KEY_ID || "";
  const cdpKeySecret = env.CDP_API_KEY_SECRET || "";
  const hasCdp = Boolean(cdpKeyId && cdpKeySecret);
  const mode = (env.FACILITATOR || "auto").toLowerCase();
  const explicitUrl = (env.FACILITATOR_URL || "").trim();

  let facilitatorKind; // "cdp" | "url"
  let facilitatorUrl;

  if (mode === "cdp") {
    if (!hasCdp) {
      throw new Error("FACILITATOR=cdp requires CDP_API_KEY_ID and CDP_API_KEY_SECRET");
    }
    facilitatorKind = "cdp";
    facilitatorUrl = CDP_FACILITATOR_URL;
  } else if (mode === "url") {
    facilitatorKind = "url";
    facilitatorUrl = explicitUrl || net.defaultFacilitatorUrl;
  } else if (!net.isTestnet) {
    if (hasCdp && (!explicitUrl || explicitUrl.includes("api.cdp.coinbase.com"))) {
      facilitatorKind = "cdp";
      facilitatorUrl = CDP_FACILITATOR_URL;
    } else if (explicitUrl) {
      facilitatorKind = "url";
      facilitatorUrl = explicitUrl;
    } else {
      throw new Error(
        "Mainnet (eip155:8453) needs CDP_API_KEY_ID + CDP_API_KEY_SECRET, " +
          "or set FACILITATOR_URL to a fallback facilitator (FACILITATOR=url).",
      );
    }
  } else {
    facilitatorKind = "url";
    facilitatorUrl = explicitUrl || net.defaultFacilitatorUrl;
  }

  if (facilitatorKind === "url" && facilitatorUrl.includes("api.cdp.coinbase.com") && !hasCdp) {
    throw new Error("FACILITATOR_URL is CDP but CDP_API_KEY_ID/SECRET are missing — set keys or FACILITATOR=cdp");
  }
  if (facilitatorKind === "url" && facilitatorUrl.includes("api.cdp.coinbase.com") && hasCdp) {
    facilitatorKind = "cdp";
  }

  return {
    PORT,
    HOST,
    PRICE,
    PAYTO,
    NETWORK,
    net,
    facilitatorKind,
    facilitatorUrl,
    hasCdp,
    serviceName: env.SERVICE_NAME || "My x402 API",
    publicBaseUrl: env.PUBLIC_BASE_URL || "",
  };
}
