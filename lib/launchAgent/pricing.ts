// lib/launchAgent/pricing.ts — every price for launch-by-chat and living coins.
// SERVER-ONLY constants. 1 Monpad credit = $0.01 face value (same ledger as Studio).
// Rule: every paid action is priced at >= MARGIN x its worst-case provider cost,
// and credits are debited BEFORE the provider call (refunded if the provider fails).

import { MODES } from '../studioServer';

export const MARGIN = Number(process.env.LAUNCH_MARGIN || '3');
export const CREDIT_USD = 0.01;

// Meshy bills in its own credits (docs.meshy.ai/en/api/pricing):
//   image-to-3D, textured mesh = 30, automatic rigging = 5.
export const MESHY_IMAGE_TO_3D_CREDITS = 30;
export const MESHY_RIG_CREDITS = 5;
export const MESHY_CHARACTER_CREDITS = MESHY_IMAGE_TO_3D_CREDITS + MESHY_RIG_CREDITS;
// USD value of ONE Meshy credit on OUR plan. Set MESHY_CREDIT_USD to the real number
// from the Meshy billing page; the default is deliberately on the high side.
export const MESHY_CREDIT_USD = Number(process.env.MESHY_CREDIT_USD || '0.02');

const ceilCredits = (usd: number) => Math.max(1, Math.ceil((usd * MARGIN) / CREDIT_USD));

/** What each step costs the user, in Monpad credits. */
export const LAUNCH_PRICES = {
  draft: MODES.chat.credits,                                  // LLM writes name/ticker/description
  art: MODES.image.credits,                                   // flux image for the token
  character: ceilCredits(MESHY_CHARACTER_CREDITS * MESHY_CREDIT_USD), // 3D living coin
} as const;

/** Hard caps so a bug or a bot can't drain provider credits. */
export const LIMITS = {
  charactersPerWalletPerDay: Number(process.env.LAUNCH_CHAR_PER_WALLET_DAY || '3'),
  charactersGlobalPerDay: Number(process.env.LAUNCH_CHAR_GLOBAL_DAY || '60'),
  draftsPerWalletPerDay: Number(process.env.LAUNCH_DRAFTS_PER_WALLET_DAY || '40'),
};

export const LAUNCH_AGENT_ENABLED = process.env.LAUNCH_AGENT_ENABLED !== 'false';
