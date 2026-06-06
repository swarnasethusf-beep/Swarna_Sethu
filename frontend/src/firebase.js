// 🔥 Firebase Client SDK — Swarna Raseid
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD4EGM8t0L-C-h3rLWZ35h09gJz7xeEdnY",
  authDomain: "swarnabill-46af4.firebaseapp.com",
  projectId: "swarnabill-46af4",
  storageBucket: "swarnabill-46af4.firebasestorage.app",
  messagingSenderId: "781470410383",
  appId: "1:781470410383:web:363a0bd768cb3a035eb2fa"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// Disable reCAPTCHA verification for testing environments
// if (process.env.NODE_ENV !== "production") {
//   // Ensure the settings object exists
//   // @ts-ignore – Firebase may not expose the type in this context
//   auth.settings = { ...(auth.settings || {}), appVerificationDisabledForTesting: true };
// }

export default firebaseApp;




