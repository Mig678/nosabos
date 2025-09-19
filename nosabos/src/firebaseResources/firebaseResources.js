import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";
import { getVertexAI, Schema } from "@firebase/vertexai";

// Firebase project config
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_PUBLIC_API_KEY,
  authDomain: "nosabo-miguel.firebaseapp.com",
  projectId: "nosabo-miguel",
  storageBucket: "nosabo-miguel.appspot.com", // ✅ keep .appspot.com, not firebasestorage.app
  messagingSenderId: "849819611707",
  appId: "1:849819611707:web:1a5f27bbe5d6da7ae7221e"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Firestore
export const database = getFirestore(app);

// Vertex AI
export const vertexAI = getVertexAI(app);
export const ai = getVertexAI(app);

// Messaging (conditionally enabled)
let messaging = null;
async function initMessaging() {
  if (await isSupported()) {
    messaging = getMessaging(app);
    console.log("Messaging enabled:", messaging);
  } else {
    console.warn("Firebase Messaging is not supported in this environment.");
  }
}
initMessaging();

// Exports
export { messaging, Schema };
