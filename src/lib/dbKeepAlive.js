// Supabase keep-alive (owner decision 2026-10-24: free option against the
// free-plan pause). A Vercel Cron job calls /api/health/db once a day; this
// handler runs one tiny read (a head-only count on `staff_roles`, no rows
// returned) so the project registers activity. The response says only whether
// the database answered; it never returns data, counts or error details.

const KEEPALIVE_TABLE = 'staff_roles';

function createDbKeepAlive({ getClient }) {
  async function ping() {
    try {
      const { error } = await getClient()
        .from(KEEPALIVE_TABLE)
        .select('user_id', { head: true, count: 'exact' })
        .limit(1);
      if (error) return { status: 503, body: { ok: false } };
      return { status: 200, body: { ok: true } };
    } catch {
      return { status: 503, body: { ok: false } };
    }
  }
  return { ping };
}

module.exports = { createDbKeepAlive, KEEPALIVE_TABLE };
