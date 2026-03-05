# Q CLUB – PWA + Cloud Sync (Supabase)

This is a Vite + React PWA.

## Run locally

```bash
npm install
npm run dev
```

## Cloud Sync (recommended)

Cloud sync stores one shared state for the whole club in Supabase so every device sees the same data.

### 1) Create Supabase project + table

In Supabase **SQL Editor**, run:

```sql
create table if not exists public.qclub_state (
  key text primary key,
  state jsonb not null,
  updated_at timestamptz default now()
);

alter table public.qclub_state enable row level security;

create policy "public read" on public.qclub_state
  for select using (true);

create policy "public write" on public.qclub_state
  for insert with check (true);

create policy "public update" on public.qclub_state
  for update using (true);
```

### 2) Add environment variables

Create a file named **.env** (same folder as `package.json`):

```
VITE_SUPABASE_URL=YOUR_PROJECT_URL
VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

Restart the dev server.

### 3) Deploy to Vercel

In Vercel → Project → **Settings → Environment Variables**, add the same 2 keys.

Then redeploy.
