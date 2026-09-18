-- Repair the stored owner phone for business 338f48b5-... ("DINS by Daniyal").
--
-- The value was saved as "92282241956" (11 digits, missing its middle "3"),
-- so every inbound WhatsApp reply from the owner's real number
-- ("923282241956" == local 03282241956) failed the tolerant phone match:
--
--   comparablePhoneKey('92282241956')  -> '282241956'   (wrong, 9 digits)
--   comparablePhoneKey('923282241956') -> '3282241956'  (correct, 10 digits)
--
-- The owner's number was verified from live inbound webhook events from that
-- number (2026-09-12). Repair to the canonical E.164 store used elsewhere.
update businesses
set phone = '923282241956',
    updated_at = now()
where id = '338f48b5-74ed-4f0b-8754-208c6fe663b5'
  and phone = '92282241956';

-- Backfill ownership on the previously-unmatched inbound events from that
-- number so the audit trail and business_id linkage are correct.
update whatsapp_inbound_events
set business_id = '338f48b5-74ed-4f0b-8754-208c6fe663b5'
where business_id is null
  and sender_phone = '923282241956';