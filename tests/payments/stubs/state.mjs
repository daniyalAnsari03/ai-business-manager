/**
 * Shared mutable state for the payments/suppliers offline tests, so test files
 * and the module-hook stubs hand data to each other without globals.
 */
export const state = {
  /** Business returned by getUserBusiness(); the "active" tenant. */
  business: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test Shop",
    businessType: "retail",
    currency: "PKR",
    language: "en",
    ownerId: "22222222-2222-4222-8222-222222222222",
    phone: null,
    address: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  /** In-memory database created by createFakeDb(); read by the supabase stub. */
  db: null,
  /** Result of getAutomationMode(): { ok, data } (needs_approval | full_auto). */
  automationModeResult: { ok: true, data: "needs_approval" },
  /** Scripted read rows consumed by the tool-test read-service stubs. */
  reads: null,
  auditRows: [],
};