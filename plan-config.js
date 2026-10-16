/*
 * Public config for the /plan/<token> invite page (site/404.html).
 *
 * Both values are PUBLIC by design: the project URL is already committed in
 * constants/, and publishableKey must be the Supabase PUBLISHABLE key
 * (sb_publishable_...), the same one the app bundle ships. NEVER a secret key
 * (sb_secret_...) and never a service_role JWT: the page calls only the two
 * anon-callable RPCs from migration 203. Locked by
 * __tests__/unit/site/plan-invite-page.test.ts.
 *
 * DEPLOY STEP: fill publishableKey in the deployed copy. While it is empty the
 * page shows "This invite can't be loaded right now" and calls nothing.
 */
window.LOOP_PLAN_CONFIG = {
  supabaseUrl: 'https://yvedmxyfehjiigikitbo.supabase.co',
  publishableKey: 'sb_publishable_DqeIdS7u_zyrCljxP9SLTw_o7A_g7Y7',
  appStoreUrl: 'https://apps.apple.com/app/loop/id6820438290',
};
