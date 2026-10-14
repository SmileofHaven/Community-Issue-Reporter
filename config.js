/* ==========================================================================
   CivicFix — frontend configuration (loaded before app.js)
   The Firebase *web* config is NOT a secret: it only identifies your project.
   Access is protected by Firebase Auth + the server-side API.
   Firebase console -> Project settings -> Your apps -> Web app -> SDK setup and configuration.
   ========================================================================== */
window.CF_CONFIG = {
  firebase: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    appId: "YOUR_APP_ID"
  },

  // Firebase web SDK version loaded from Google's CDN (change here only).
  firebaseSdkVersion: "12.11.0",

  // "" = the API lives on the same site (Vercel). Set to "https://your-app.vercel.app"
  // only if this frontend is served from somewhere else (then add that origin to ALLOWED_ORIGINS).
  apiBase: "",

  // Map centre used until the user shares / searches a location.
  defaultCenter: { lat: 12.9716, lng: 77.5946, address: "MG Road, Central District" },

  // Radius (km) of the "near me" boxes on first visit.
  nearbyRadiusKm: 5
};
