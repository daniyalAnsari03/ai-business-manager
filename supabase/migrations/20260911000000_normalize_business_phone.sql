-- Normalize legacy business phone values to digits-only (E.164 without
-- the "+"). Inbound WhatsApp approval replies are matched against the
-- business phone by digits, so stored values like "+923219830968" must
-- compare equal to the sender's "923219830968". The code now tolerates
-- both formats, but this canonicalizes existing rows so future exact
-- lookups stay consistent.
update businesses
set phone = regexp_replace(phone, '\D', '', 'g'),
    updated_at = now()
where phone is not null and phone <> regexp_replace(phone, '\D', '', 'g');