import { z } from "zod";

export async function validateCoupleUpgrade(client) {
  const {
    rows: [state],
  } = await client.query(`
    SELECT to_regclass('public.users') IS NOT NULL AS has_users,
      EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users'
          AND column_name = 'registration_completed_at') AS has_registration`);
  if (!state.has_users) return;

  const {
    rows: [counts],
  } = await client.query("SELECT count(*)::int AS total FROM users");
  if (counts.total === 0) return;

  if (!state.has_registration) {
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('source_documents', 'service_credentials')
        AND column_name = 'attributed_user_id' AND is_nullable = 'NO'`);
    if (rows.length !== 2) {
      throw new Error("Cannot verify registration state in an unknown nonempty schema");
    }
  }

  const ids = z
    .object({
      owner: z.string().uuid(),
      partner: z.string().uuid(),
      ledger: z.string().uuid(),
    })
    .refine(({ owner, partner }) => owner !== partner)
    .safeParse({
      owner: process.env.COUPLE_OWNER_USER_ID,
      partner: process.env.COUPLE_PARTNER_USER_ID,
      ledger: process.env.COUPLE_LEDGER_ID,
    });
  if (!ids.success) throw new Error("Two distinct member IDs and a shared ledger ID are required");
  const {
    rows: [members],
  } = await client.query(
    `SELECT count(*)::int AS total FROM users
     WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
     ${state.has_registration ? "AND registration_completed_at IS NOT NULL" : ""}`,
    [[ids.data.owner, ids.data.partner]]
  );
  if (members.total !== 2) throw new Error("Both configured members must be active");
}
