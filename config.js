/* ==========================================================================
   CivicFix — frontend configuration (loaded before app.js)
   The Firebase *web* config is NOT a secret: it only identifies your project.
   Access is protected by Firebase Auth + the server-side API.
   Firebase console -> Project settings -> Your apps -> Web app -> SDK setup and configuration.
   ========================================================================== */
window.CF_CONFIG = {
  firebase: {
    apiKey: "AIzaSyB6MiI8bP_kdkEAW1f65I4BWC24HX5tzps",
    authDomain: "civilfix-f6118.firebaseapp.com",
    projectId: "civilfix-f6118",
    appId: "1:700323920618:web:b73cb78c8b03be09fe7593"
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
