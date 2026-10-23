# Monpad progress (launch-by-chat + living coins)

Branch: `feat/launch-by-chat` (from `rebuild/3d-pad`).

## Works
- **Real 3D Monshi in the hero**: Meshy image-to-3D + rigging, compressed to 731 KB (`public/models/monshi.glb`, meshopt). Head follows the cursor; wave / celebrate / facepalm / launch moods drive the arms and head. Phones and reduced-motion keep the poster.
- **Launch by chat** (`/chat`): idea -> draft -> art -> optional 3D character -> prefilled `/create`.
- **API** (`/api/v1/launch/*`): `draft`, `art`, `prices`, `character` (start), `character/[id]` (poll + link to token), `living?token=`.
  Auth = the Studio daily wallet signature. Debit-before-work through the Studio credit ledger; refund on failure. Per-wallet and global daily caps. Kill switch `LAUNCH_AGENT_ENABLED=false`.
- **MCP tools**: `monpad_launch_prices`, `monpad_draft_launch`, `monpad_make_art`, `monpad_start_character`, `monpad_character_status`, `monpad_prepare_launch`.
- **Living coins**: `components/token/LivingCoin.tsx` on the token page when a character is linked; mood from `lib/mood.ts` (price change -> idle/happy/cheer/droop/fire).

## Needs you
1. Run the new SQL block (`launch_characters`, section 4e) in `supabase/schema.sql` in the Supabase editor.
2. Env vars: `MESHY_API_KEY` (server only), `VENICE_API_KEY` (already used by Studio), optional `MESHY_CREDIT_USD` (real USD per Meshy credit, default 0.02), `LAUNCH_MARGIN` (default 3), `LAUNCH_CHAR_PER_WALLET_DAY` (3), `LAUNCH_CHAR_GLOBAL_DAY` (60).
3. Confirm `MESHY_CREDIT_USD` against the Meshy billing page; the 3D character price is derived from it.

## Measured
- One character = 30 (image-to-3D, textured) + 5 (rigging) = 35 Meshy credits.
- Monshi hero build used 35 credits (balance was 4,989).

## Not done
- Per-token AI voice (flagged off / not built).
- Server-side GLB compression for user characters (raw Meshy GLBs are ~5 MB).
- Unit tests for moderation and `lib/mood.ts`.
- Mobile hero still uses the 2D poster by design.
