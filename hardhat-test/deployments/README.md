# Deployments

`v3-143.json` records the **superseded TEST** factory (`0x45Fb…` / `0xE27E…`).
Do **not** point Vercel at those addresses — they are in `SUPERSEDED_FACTORIES` and the
frontend board would stay empty / refuse launches.

## Clean board (wipe old tokens)

1. `npx hardhat run scripts/deployV3.js --network monadMainnet`
2. This folder gets a fresh `v3-143.json` overwrite with the new addresses
3. Set `NEXT_PUBLIC_FACTORY_V3` + `NEXT_PUBLIC_GRADUATOR_V3` on Vercel
4. Redeploy frontend

Token PFPs / meta stay on **Supabase** (`images` + `token_meta`) — see `docs/REDEPLOY.md`.
