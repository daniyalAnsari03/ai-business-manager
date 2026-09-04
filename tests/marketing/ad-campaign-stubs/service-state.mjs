// Shared mutable state so the stubs and the test can agree on what the fake
// service layer returns per case. The test writes these before calling the
// tool's execute().
export const serviceState = {
  // { ok: true, data: Product[] } | { ok: false, reason }
  products: { ok: true, data: [] },
  // See lib/marketing/service.ts getMetaAdsConnection return shape.
  metaAdsConnection: { ok: true, data: { connected: false, account: null } },
};
