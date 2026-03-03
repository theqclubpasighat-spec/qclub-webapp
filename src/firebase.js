// Firebase client (Web) config for TheQClub.
// NOTE: These values are safe to be public (they identify the project).
// Security is enforced via Firestore Security Rules + Auth, not by hiding these values.

import { initializeApp, getApps } from "firebase/app";
import { initializeFirestore, getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyD8rKGc7JSt03f5irwdTLSYT9pefUMECg",
  authDomain: "theqclub-6545f.firebaseapp.com",
  projectId: "theqclub-6545f",
  storageBucket: "theqclub-6545f.firebasestorage.app",
  messagingSenderId: "43404536838",
  appId: "1:43404536838:web:e768a35019cc6ab2096787",
  measurementId: "G-62CFD2Q6W9",
};

// Reuse app instance across HMR / multiple imports
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Some browsers / networks block Firestore's streaming transport.
// These settings make Firestore fall back to long-polling more reliably.
export const db = (() => {
  try {
    return initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      experimentalForceLongPolling: true,
      useFetchStreams: false,
    });
  } catch (e) {
    // If already initialized, just return the existing instance.
    return getFirestore(app);
  }
})();
