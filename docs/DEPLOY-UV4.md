# UV4 mainnet deployment (Monad, chain 143)

Deployed 2026-10-24 by `0xf90bBe889167269f90c5AD28a402f4ff19658675` with `hardhat-test/scripts/deployUV4Full.js`. Not professionally audited (see `AUDIT-UV4.md`).

| Contract | Address |
|---|---|
| MonpadHook | `0xaff86Dd6e66df26b971767959e854e12b5f7a080` |
| MonpadHookLauncher | `0x2d55391d4170C7cAF9eE53Cf8BAD00748452ec84` |
| MonpadV4Router | `0xC20A50750a75d2d8FFF47E63003636C3CF0bb18c` |

Quote: USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`. **No creation fee. Start market cap 3,000 USDC** (startTick 403400). Launch, dev buy and trades can all be paid in MON (`launchWithMon`, `buyWithMon`, `sellToMon`), converted to USDC inside the same transaction.
Platform `0xf4352d939b90b4f589ddc12a7064b57039242a47`. MONSHI wallet `0x5a741bff115b3c5409da04ee7ab9b0f4e5e1f288`.

**Ownership:** the launcher is `Ownable2Step`. Ownership was proposed to `0xf4352d939b90b4f589ddc12a7064b57039242a47`; until that wallet calls `acceptOwnership()` the deployer is still owner. The router and hook have no owner.

Source is verified on Sourcify (chain 143) for all three contracts.

Live smoke test on mainnet (MON only, no USDC held): `launchWithMon` with 2 MON, `buyWithMon` 1 MON, `sellToMon` half, `harvest`. All succeeded; the launcher held 0 USDC and 0 MON afterwards. Test token: `0x23A13ca5476f02D4DbDfB0987AC3cFF9B27FC4a5` ("Monpad Test").

Superseded first deployment (100 USDC fee, 250K start, no MON launch; unused): hook `0xaE80…2080`, launcher `0xbB72…5e0b`, router `0xdd7E…d4D7`.

Site env (Vercel) to turn the V4 pad on:
```
NEXT_PUBLIC_LAUNCHER_UV4=0x2d55391d4170C7cAF9eE53Cf8BAD00748452ec84
NEXT_PUBLIC_HOOK_UV4=0xaff86Dd6e66df26b971767959e854e12b5f7a080
NEXT_PUBLIC_ROUTER_UV4=0xC20A50750a75d2d8FFF47E63003636C3CF0bb18c
```
