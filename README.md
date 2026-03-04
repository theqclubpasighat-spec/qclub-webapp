# Q CLUB Web App (PWA) — Firebase Cloud Sync + Vercel Deploy

This is a Vite + React PWA.

It works in **two modes**:

- **Local mode (default)**: data saved in the browser (localStorage).
- **Cloud Sync mode (recommended)**: if Firebase env vars are set, the app syncs a single shared state via **Firestore** so all phones see the same players/offers/etc.

You’ll see a pill in the top bar:
- `Cloud: OFF` (local only)
- `Cloud: Syncing` / `Cloud: ON`
- `Cloud: ERROR` (Firebase env vars / Firestore rules issue)

---

## 1) Run locally (VS Code)

```bash
npm install
npm run dev
```

---

## 2) Create Firebase project + Firestore (baby steps)

### A) Create project
1. Go to **Firebase Console**
2. **Add project** → create (any name)
3. After project is created:
   - In the left menu: **Build → Firestore Database**
   - Click **Create database**
   - Choose **Production** (recommended) or **Test** (fast)
   - Pick a location (closest region)

### B) Create a Web App
1. Firebase Console → Project settings (⚙️)
2. Scroll to **Your apps**
3. Click **</> Web app**
4. Register app (name like `qclub-web`)
5. Copy the config values (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId)

### C) Firestore rules (simple for launch)
In **Firestore → Rules**, paste this (public read/write) so cloud sync works immediately:

> Note: this is OK for launch/testing, but later we should lock it down (PIN/auth).

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /qclub/{docId} {
      allow read, write: if true;
    }
  }
}
```

---

## 3) Add Firebase env vars

### Local dev
Create a file named **.env** in the project root (same folder as package.json):

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Restart `npm run dev`.

### Vercel deploy
In **Vercel → Project → Settings → Environment Variables**, add the same keys above (all of them).
Then redeploy.

---

## 4) Deploy to Vercel (GitHub flow)

1. Push this project to GitHub
2. Vercel → **New Project** → Import your repo
3. Framework preset: **Vite**
4. Build command: `npm run build`
5. Output directory: `dist`
6. Add env vars (step 3)
7. Deploy

---

## Where cloud state is stored
Firestore document:

- Collection: `qclub`
- Doc: `state`

The app writes `{ state: <big json>, updated_at: serverTimestamp() }`.

---

## Notes
- Autoplay audio is blocked by many browsers until the user taps once.
