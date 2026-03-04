// Firebase init (Firestore) - uses Vercel/Vite env vars
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

function env(name) {
  // Vite exposes env vars with import.meta.env
  return (import.meta?.env && import.meta.env[name]) || "";
}

const firebaseConfig = {
  apiKey: env("VITE_FIREBASE_API_KEY"),
  authDomain: env("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: env("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: env("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: env("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: env("VITE_FIREBASE_APP_ID"),
};

const missing = Object.entries(firebaseConfig).filter(([_, v]) => !v).map(([k]) => k);

export const firebaseReady = missing.length === 0;

let app = null;
let db = null;

export function getFirebaseApp() {
  if (!firebaseReady) return null;
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

export function getDb() {
  if (!firebaseReady) return null;
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

export function getFirebaseMissingVars() {
  return missing;
}
