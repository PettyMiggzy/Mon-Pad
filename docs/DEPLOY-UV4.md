# UV4 mainnet deployment (Monad, chain 143)

Deployed 2026-10-24 by `0xf90bBe889167269f90c5AD28a402f4ff19658675` with `hardhat-test/scripts/deployUV4Full.js`. Not professionally audited (see `AUDIT-UV4.md`).

| Contract | Address |
|---|---|
| MonpadHook | `0xaE80C0eC737700e3dE0dFD8De6B7437351DF2080` |
| MonpadHookLauncher | `0xbB720AC8Eb7Ed7a6E868b6335972Dbb71d585e0b` |
| MonpadV4Router | `0xdd7E7564BeB62DD715105654082582451b66d4D7` |

Quote: USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`. Start market cap 250,000 USDC (startTick 359200). Creation fee 100 USDC.
Platform `0xf4352d939b90b4f589ddc12a7064b57039242a47`. MONSHI wallet `0x5a741bff115b3c5409da04ee7ab9b0f4e5e1f288`.

**Ownership:** the launcher is `Ownable2Step`. Ownership was proposed to `0xf4352d939b90b4f589ddc12a7064b57039242a47`; until that wallet calls `acceptOwnership()` the deployer is still owner. The router and hook have no owner.

Source is verified on Sourcify (chain 143) for all three contracts.

Site env (Vercel) to turn the V4 pad on:
```
NEXT_PUBLIC_LAUNCHER_UV4=0xbB720AC8Eb7Ed7a6E868b6335972Dbb71d585e0b
NEXT_PUBLIC_HOOK_UV4=0xaE80C0eC737700e3dE0dFD8De6B7437351DF2080
NEXT_PUBLIC_ROUTER_UV4=0xdd7E7564BeB62DD715105654082582451b66d4D7
```
