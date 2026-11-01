# Tamagotchi Monshi: setup checklist

Values are NOT stored here. Keep them in a password manager and in Vercel (Project, Settings, Environment Variables).
If a value is lost, generate a new one and set it again. The only effect is that people have to switch reminders back on.

## 1. Database (once)
Run `supabase/pet.sql` in the Supabase SQL editor. It creates `pet_purchases` and `pet_push_subs`. Done on 2026-11-02.

## 2. Vercel environment variables
| Name | What it is | How to get it |
|---|---|---|
| `STUDIO_TREASURY` | Wallet that receives MONSHI (shop) and MON (Studio) | Your treasury wallet address |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Public half of the push keys | `npx web-push generate-vapid-keys` (the "Public Key") |
| `VAPID_PRIVATE_KEY` | Private half. Secret. | Same command ("Private Key") |
| `VAPID_SUBJECT` | Contact for push services | `mailto:you@yourdomain.com` |
| `CRON_SECRET` | Password for the reminder sender | `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Already set for the game | Supabase project settings |

Redeploy after changing any of them.

## 3. Hourly reminder sender (droplet)
`crontab -e`, then add (use the same `CRON_SECRET`):

    0 * * * * curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" https://www.monpad.net/api/pet/push-send

Check with `crontab -l`. A manual test returns JSON like `{"due":0,"sent":0,...}`; a wrong secret returns 401.

## 4. Shop prices
`lib/pet/shop.ts`. Fixed MONSHI amounts, so update them when the MONSHI price moves a lot.

## 5. Tests
`npx tsx scripts/pet-unit.mts` checks MONSHI payment matching and push timing.
