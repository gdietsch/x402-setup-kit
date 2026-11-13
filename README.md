# x402 setup kit

A minimal Express starter that paywalls a route with [x402](https://www.x402.org/) v2.

It is the same payment stack we run in production on the [Trading Signals Toolkit](https://signals.incomefather.com): **USDC on Base and Solana**, **Coinbase CDP + PayAI** facilitators, and **optional Stripe MPP** (Tempo USDC). Copy it, change `GET /hello` to your own API, and you have pay-per-call.

If you would rather have us wire it up, see the [done-for-you setup service](https://signals.incomefather.com/setup) ($149 review or $499 full setup). Guide: [Add x402 payments to your API](https://signals.incomefather.com/guides/add-x402-to-your-api).

## What you get

- One paid route (`GET /hello`) that returns **HTTP 402** with a valid x402 v2 `PAYMENT-REQUIRED` header until the caller pays
- Base (EVM) USDC via the `exact` scheme; optional Solana USDC when `SOLANA_PAY_TO` is set
- Facilitator fallback: CDP on Base mainnet when you have CDP keys, PayAI as the second facilitator (and on testnet)
- Optional Stripe Machine Payments Protocol (inert until Stripe + Tempo env vars are set)
- Free discovery files: `/health`, `/openapi.json`, `/.well-known/x402`, `/llms.txt`
- A listing checklist for x402scan, PayAI, the MCP Registry, `llms.txt` and OpenAPI
- Dockerfile and Railway deploy steps
- MIT license

## Quickstart

You need Node 22+.

```bash
git clone https://github.com/gdietsch/x402-setup-kit.git
cd x402-setup-kit
cp .env.example .env
# Optional: set PAYTO_ADDRESS to your Base address. The placeholder is fine for a local 402 test.
npm install
npm start
```

Or, after a clone, one command:

```bash
npm run quickstart
```

In another terminal:

```bash
curl -i http://localhost:4021/hello
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: <base64 JSON with price, network, payTo>
```

Open `http://localhost:4021/hello` in a browser to see the wallet paywall. Free pages such as `/` and `/health` stay unpaid.

### Testnet vs mainnet

| | Testnet (default) | Mainnet |
| --- | --- | --- |
| `NETWORK` | `eip155:84532` (Base Sepolia) | `eip155:8453` (Base) |
| Facilitator | PayAI public URL (no keys) | CDP keys, or `FACILITATOR_URL` |
| Money | Test USDC, no real value | Real USDC |

On mainnet, set `PAYTO_ADDRESS` to a dedicated wallet you control, add `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`, and set `PUBLIC_BASE_URL` to your public HTTPS origin.

### Solana

Set `SOLANA_PAY_TO` to a Solana address that already has a USDC token account. The 402 will then also offer Solana USDC, settled through PayAI.

### Stripe MPP (optional)

When `STRIPE_SECRET_KEY`, `STRIPE_PROFILE_ID` and `TEMPO_DEPOSIT_ADDRESS` are all set, the same 402 also includes `WWW-Authenticate: Payment method="tempo"`. Agents can retry with `Authorization: Payment …`. Amounts under a cent round up to the next cent. Leave these unset if you do not need MPP.

## Add your own route

In `src/server.js`, copy the `GET /hello` entry in `paidRoutes`, point it at your path and price, and add a handler. Keep `/`, `/health`, `/openapi.json`, `/.well-known/x402` and `/llms.txt` free so agents and directories can discover you. Failed responses (4xx/5xx) are not settled by x402.

## Deploy on Railway

1. Push this repo to GitHub (or fork it).
2. In [Railway](https://railway.app), **New project → Deploy from GitHub repo**.
3. Set the env vars from `.env.example`: at least `PAYTO_ADDRESS`, `NETWORK=eip155:8453`, `PUBLIC_BASE_URL=https://your-service.up.railway.app` (or your domain), and your CDP keys.
4. Railway injects `PORT`. The Dockerfile and `src/server.js` already honor it.
5. After the deploy, check:

```bash
curl -i https://your-service.up.railway.app/health     # 200
curl -i https://your-service.up.railway.app/hello      # 402
```

The same container runs on any host that provides `PORT` (Fly, Render, a VPS). Put HTTPS in front of it.

## Listing checklist

Once a paid route returns a correct 402 on a public HTTPS URL, work through [CHECKLIST.md](./CHECKLIST.md): x402scan, PayAI Bazaar, `llms.txt`, OpenAPI, and (if you have an MCP server) the MCP Registry.

## Tests

```bash
PAYTO_ADDRESS=0x0000000000000000000000000000000000000001 npm test
```

The unpaid test boots the app in memory (no wallet, no network spend) and checks that `GET /hello` returns a 402 whose `PAYMENT-REQUIRED` header lists Base and Solana accepts at `$0.01`.

## Want us to do it?

[Kit Review ($149)](https://signals.incomefather.com/setup) or [Full Setup ($499)](https://signals.incomefather.com/setup): we review your 402s or add x402 to one existing API, deploy, and list you. Questions: [gdietsch-j16thn@mail.grokbot.com](mailto:gdietsch-j16thn@mail.grokbot.com).

## License

MIT. See [LICENSE](./LICENSE).
