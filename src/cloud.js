// src/cloud.js
import { db } from "./firebase";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";

/**
 * We store ALL state in ONE Firestore document:
 *   collection: qclub
 *   doc: state
 */
const CLOUD_COLLECTION = "qclub";
const CLOUD_DOC = "state";

function ref() {
  return doc(db, CLOUD_COLLECTION, CLOUD_DOC);
}

/**
 * ✅ FIX: Exported so App.jsx can import it without build failure
 * Returns { ok: boolean, reason?: string }
 */
export function cloudAvailable() {
  try {
    if (!db) return { ok: false, reason: "Firestore db not initialized" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || "unknown" };
  }
}

export async function cloudLoadState() {
  const snap = await getDoc(ref());
  if (!snap.exists()) return null;

  const data = snap.data();
  // Your document structure: { data: {...actualState...} }
  // (based on your Firebase screenshots)
  if (data && typeof data === "object" && data.data && typeof data.data === "object") {
    return data.data;
  }
  // fallback if someone saved state at top-level
  return data || null;
}

export async function cloudSaveState(stateObj) {
  // Always write under { data: ... } to match your Firestore structure
  await setDoc(
    ref(),
    { data: stateObj },
    { merge: true }
  );
}

export function cloudSubscribeState(onData, onError) {
  return onSnapshot(
    ref(),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      if (data && data.data && typeof data.data === "object") {
        onData(data.data);
      } else {
        onData(data || null);
      }
    },
    (err) => {
      onError && onError(err);
    }
  );
}