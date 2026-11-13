# Listing checklist

Do these after your API is on a public HTTPS URL and `curl -i https://your-api.example/your-paid-route` returns **402** with a `PAYMENT-REQUIRED` header.

Keep `/`, `/health`, `/openapi.json`, `/.well-known/x402` and `/llms.txt` free. This kit already serves them.

## 1. OpenAPI and llms.txt

- [ ] `GET /openapi.json` lists every paid route, its price, and a short description.
- [ ] `GET /llms.txt` is a plain-text summary agents can read (see the kit's `/llms.txt`).
- [ ] `GET /.well-known/x402` advertises networks, asset (USDC) and `payTo`.
- [ ] `PUBLIC_BASE_URL` is your public origin so these files use the right host.

## 2. x402scan

- [ ] Open [x402scan.com](https://www.x402scan.com) and submit or confirm your resource URL.
- [ ] A successful paid call (even a $0.01 test from your own wallet) helps the catalog pick you up.
- [ ] Confirm the listed price, network and `payTo` match production.

## 3. PayAI Bazaar

- [ ] Use PayAI as a facilitator (this kit does, when `PAYAI_ENABLED=1`).
- [ ] Leave `PAYAI_MIRROR_VERIFY=1` so successful Base verifies are catalogued.
- [ ] For a formal listing, follow [PayAI's docs](https://docs.payai.network) for Bazaar discovery. Listing a route usually costs a few cents in USDC.
- [ ] If you take Solana USDC, `SOLANA_PAY_TO` must already have a USDC token account.

## 4. MCP Registry (only if you have an MCP server)

- [ ] If your API also exposes an MCP server, publish it to the [official MCP Registry](https://github.com/modelcontextprotocol/registry).
- [ ] Use a remote Streamable HTTP URL or an npm package, a unique server name, and a short description.
- [ ] Keep a free or anonymous path so reviewers can try the tools.

Skip this step if you only have a plain HTTP API.

## 5. Other discovery (optional, all free)

- [ ] Add a sitemap and submit new URLs with [IndexNow](https://www.indexnow.org).
- [ ] List the MCP (if any) on community directories such as cursor.directory or Glama.
- [ ] Link the GitHub repo and this checklist from your homepage.

## 6. Safety before you take real money

- [ ] `PAYTO_ADDRESS` (and `SOLANA_PAY_TO`) are dedicated wallets, not ones that hold other funds.
- [ ] You are on `NETWORK=eip155:8453` only when you intend to take mainnet USDC.
- [ ] Failed calls (4xx/5xx) are not settled — do not send a 2xx until the work is done.
- [ ] You never committed `.env` or a private key.

Need a second pair of eyes? [Kit Review is $149](https://signals.incomefather.com/setup). Want us to do the setup and the listings? [Full Setup is $499](https://signals.incomefather.com/setup).
