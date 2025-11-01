import 'dotenv/config';
import pg from 'pg';

const { DATABASE_URL, CLERK_SECRET_KEY } = process.env;
if (!DATABASE_URL || !CLERK_SECRET_KEY) {
  console.error('Missing env: DATABASE_URL or CLERK_SECRET_KEY');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

type ClerkUser = {
  id: string;
  email_addresses: { email_address: string }[];
  first_name?: string | null;
  last_name?: string | null;
  created_at?: number; // ms epoch
};

async function fetchAllClerkUsers(): Promise<ClerkUser[]> {
  const users: ClerkUser[] = [];
  let url = 'https://api.clerk.com/v1/users?limit=100';
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!res.ok) throw new Error(`Clerk API error: ${res.status}`);
    const data = await res.json();
    console.log(data);

    const usersArray = Array.isArray(data) ? data : data.data || [];
    users.push(...usersArray);

    url = data?.links?.next || data?.next_cursor ? `https://api.clerk.com/v1/users?limit=100&offset=${data.next_cursor}` : '';
  }
  return users;
}

function fullName(u: ClerkUser) {
  const fn = u.first_name?.trim() || '';
  const ln = u.last_name?.trim() || '';
  return [fn, ln].filter(Boolean).join(' ');
}

async function upsertUser(u: ClerkUser) {
  const email = u.email_addresses?.[0]?.email_address?.toLowerCase() || null;
  if (!email) return;
  const name = fullName(u);
  const createdAt =
    u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString();

  await pool.query(
    `
    INSERT INTO "User" (id, email, name, "createdAt")
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          name = EXCLUDED.name
  `,
    [u.id, email, name, createdAt]
  );
}

(async () => {
  try {
    const all = await fetchAllClerkUsers();
    for (const u of all) {
      await upsertUser(u);
    }
    console.log(`Backfill completed. Upserted ${all.length} users.`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
