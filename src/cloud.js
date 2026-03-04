import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb, firebaseReady, getFirebaseMissingVars } from "./firebase";

// One single shared document for the whole club.
// Change this if you ever want multiple "clubs" or "seasons".
const COLLECTION = "qclub";
const DOC_ID = "state";

export function isCloudEnabled() {
  return firebaseReady;
}

export function cloudMissingVars() {
  return getFirebaseMissingVars();
}

export function subscribeState(onState, onError) {
  if (!firebaseReady) {
    onError?.(new Error("Firebase env vars missing: " + getFirebaseMissingVars().join(", ")));
    return () => {};
  }

  const db = getDb();
  const ref = doc(db, COLLECTION, DOC_ID);

  return onSnapshot(
    ref,
    (snap) => {
      const data = snap.data();
      if (data && data.state) onState(data.state);
    },
    (err) => onError?.(err)
  );
}

export async function writeState(state) {
  if (!firebaseReady) throw new Error("Firebase env vars missing: " + getFirebaseMissingVars().join(", "));
  const db = getDb();
  const ref = doc(db, COLLECTION, DOC_ID);
  await setDoc(ref, { state, updated_at: serverTimestamp() }, { merge: true });
}
