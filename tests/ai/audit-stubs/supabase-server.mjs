import { serviceState } from "./service-state.mjs";

/**
 * Stand-in for the service-role client. Only the audit_logs insert is
 * meaningful here: it records what the writer would have persisted, and can be
 * made to fail so the "audit failure must not break the business action"
 * guarantee is exercised.
 */
export async function getSupabaseAdminClient() {
  if (!serviceState.audit.adminAvailable) return null;
  return {
    from(table) {
      if (table !== "audit_logs") {
        throw new Error(`audit test stub: unexpected table "${table}"`);
      }
      return {
        async insert(row) {
          if (serviceState.audit.insertError) {
            return { data: null, error: { message: serviceState.audit.insertError } };
          }
          serviceState.audit.rows.push(row);
          return { data: row, error: null };
        },
      };
    },
  };
}

export async function getSupabaseServerClient() {
  throw new Error("audit test stub: getSupabaseServerClient must not be reached");
}

export async function getServerUser() {
  return { id: "stub-user", email: null, user_metadata: {} };
}
