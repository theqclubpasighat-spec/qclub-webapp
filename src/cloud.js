// Firestore-based cloud sync.
// This keeps your admin changes (players, offers, fixtures, admin pin, etc.)
// consistent across devices and survives uninstall/reinstall.

import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";

import { firebaseConfig } from "./firebase";

function getDb() {
  // Avoid re-initializing in HMR.
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
}

const DOC_PATH = ["qclub", "state"]; // collection, doc

// Exported in the names used by the app.
export const cloudAvailable = true;

export async function cloudLoadState() {
  const db = getDb();
  const ref = doc(db, DOC_PATH[0], DOC_PATH[1]);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const v = snap.data();
  return v?.data ?? null;
}

export async function cloudSaveState(data) {
  const db = getDb();
  const ref = doc(db, DOC_PATH[0], DOC_PATH[1]);
  await setDoc(
    ref,
    {
      data,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function cloudSubscribeState(onData) {
  const db = getDb();
  const ref = doc(db, DOC_PATH[0], DOC_PATH[1]);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const v = snap.data();
    if (v?.data) onData(v.data);
  });
}

// Back-compat exports (older names)
export const cloudPull = cloudLoadState;
export const cloudPush = cloudSaveState;
export const cloudSubscribe = cloudSubscribeState;
