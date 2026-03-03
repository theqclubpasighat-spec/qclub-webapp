// src/cloud.js
import { doc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const COLLECTION = "qclub";
const DOCUMENT = "state";

export function listenToCloud(onData) {
  const ref = doc(db, COLLECTION, DOCUMENT);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return;
      const cloudData = snap.data()?.data;
      if (!cloudData) return;
      onData(cloudData);
    },
    (err) => {
      console.error("Cloud listen error:", err);
    }
  );
}

export async function pushToCloud(data) {
  try {
    const ref = doc(db, COLLECTION, DOCUMENT);
    await setDoc(
      ref,
      {
        data,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error("Cloud write error:", err);
  }
} 