/**
 * /pad — alias for /lab.
 *
 * The launcher lives at /lab, but "pad" is what anyone actually types. Rather than pick one and leave
 * the other 404ing, both routes render the same page. No redirect, so whichever URL you land on stays
 * in the address bar.
 *
 * Inherits everything from the real page: ADMIN_WALLETS gate, noindex, and no nav entry anywhere.
 */
export { default } from './lab';
