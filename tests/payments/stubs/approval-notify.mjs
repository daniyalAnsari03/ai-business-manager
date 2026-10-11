/** Stand-in for lib/marketing/whatsapp/approval-notify: never touch the network. */
export async function sendApprovalRequest() {
  return { ok: true };
}