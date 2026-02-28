# Q CLUB – PWA + Optional Cloud Sync

This project works in **two modes**:

1) **Local Mode (default)**
- Data (players, offers, admin PIN, etc.) is stored in the browser (localStorage).
- If you uninstall the app, the data resets on that phone. (This is normal.)
- Friends will NOT see your changes because each device keeps its own data.

2) **Cloud Sync Mode (recommended)**
- Data is stored online (Supabase) so:
  - Reinstalling the app keeps your admin PIN + all changes.
  - Your friends see the same player list / offers, etc.

---

## A) Run locally

```bash
npm install
npm run dev
```

---

## B) Enable Cloud Sync (Supabase) – 10 mins

### 1) Create a Supabase project
- Create a new project in Supabase
- Go to **Project Settings → API**
- Copy:
  - **Project URL**
  - **anon public key**

### 2) Create the table
In Supabase SQL Editor, run:

```sql
create table if not exists public.qclub_state (
  key text primary key,
  state jsonb not null,
  updated_at timestamptz default now()
);

alter table public.qclub_state enable row level security;

-- Public read/write (ok for testing). Later you can lock this down.
create policy "public read" on public.qclub_state
  for select using (true);

create policy "public write" on public.qclub_state
  for insert with check (true);

create policy "public update" on public.qclub_state
  for update using (true);
```

### 3) Add environment variables
Create a file named **.env** (in the project root, same place as package.json):

```
VITE_SUPABASE_URL=YOUR_URL_HERE
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY_HERE
```

Restart dev server after adding .env.

### 4) Deploy (Vercel)
- In Vercel project settings → **Environment Variables** add the same 2 keys:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Redeploy.

When Cloud Sync is active, you’ll see a badge like **Cloud: synced** in the top bar.

---

## Notes about music autoplay
- **Phones**: autoplay is usually blocked until the user taps once.
- **Desktop**: autoplay is also blocked by most browsers unless muted.

So the app tries to play automatically, but it may require one tap.
