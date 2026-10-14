/* ==========================================================================
   CivicFix — shared application logic (vanilla JS, zero dependencies)
   Handles: Firebase auth session, REST API client (/api/*), Cloudinary photo
            upload, UI helpers, toasts, modals, Leaflet map helpers, geocoding.
   ========================================================================== */
(function (global) {
  "use strict";

  var STATUSES    = ["New", "Assigned", "In Progress", "Closed"];
  var CFG         = global.CF_CONFIG || {};
  var TEST        = global.__CF_TEST__ || {};   // hooks used only by the automated tests
  var KEY_SESSION = "civicfix.session.v2";   // sessionStorage: cached /api/me result (5 min)
  var KEY_LOC     = "civicfix.location.v1";  // localStorage: last chosen "near me" location
  var SESSION_TTL = 5 * 60 * 1000;

  /* ============================================================== theme init */
  // Apply saved theme immediately on script load to prevent flashing
  var savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);

  /* ============================================================== config */
  var ICONS = {
    pothole: "\uD83D\uDD73\uFE0F", drainage: "\uD83C\uDF0A", streetlight: "\uD83D\uDCA1",
    garbage: "\uD83D\uDDD1\uFE0F", water: "\uD83D\uDEB0", other: "\uD83D\uDCCD"
  };
  // Fallback used if GET /api/config is unreachable. The server's list is the source of truth.
  var appConfig = {
    categories: [
      { id: "pothole", label: "Pothole" }, { id: "drainage", label: "Drainage / Overflow" },
      { id: "streetlight", label: "Streetlight Out" }, { id: "garbage", label: "Garbage Dump" },
      { id: "water", label: "Water Leakage" }, { id: "other", label: "Other" }
    ],
    teams: ["Roads & Potholes Crew", "Drainage Unit", "Electrical Team", "Sanitation Dept.", "Water Works"],
    priorities: ["Low", "Medium", "High"]
  };

  function loadConfig() {
    return fetch((CFG.apiBase || "") + "/api/config", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) {
        if (c && c.categories && c.teams) {
          appConfig.categories = c.categories;
          appConfig.teams = c.teams;
          if (c.priorities) { appConfig.priorities = c.priorities; }
        }
        return appConfig;
      })
      .catch(function () { return appConfig; });
  }
  function categories() {
    return appConfig.categories.map(function (c) {
      return { id: c.id, label: c.label, icon: ICONS[c.id] || ICONS.other };
    });
  }
  function teams() { return appConfig.teams.slice(); }
  function defaultCenter() {
    return CFG.defaultCenter || { lat: 12.9716, lng: 77.5946, address: "" };
  }

  /* ============================================================== firebase */
  var fb = null, initPromise = null;

  function firebaseConfigured() {
    if (TEST.firebase) { return true; }
    var f = CFG.firebase || {};
    return !!(f.apiKey && f.projectId && String(f.apiKey).indexOf("YOUR_") !== 0 &&
              String(f.projectId).indexOf("YOUR_") !== 0);
  }

  /* Loads the Firebase Auth SDK from Google's CDN and waits for the first auth state. */
  function init() {
    if (initPromise) { return initPromise; }
    initPromise = (async function () {
      if (TEST.firebase) { fb = TEST.firebase; return fb; }   // test hook (automated tests only)
      if (!firebaseConfigured()) {
        var e = new Error("Firebase is not configured yet. Fill in config.js with your project's web config.");
        e.code = "cf/not-configured";
        throw e;
      }
      var base = "https://www.gstatic.com/firebasejs/" + (CFG.firebaseSdkVersion || "12.11.0") + "/";
      var appMod = await import(base + "firebase-app.js");
      var authMod = await import(base + "firebase-auth.js");
      var auth = authMod.getAuth(appMod.initializeApp(CFG.firebase));
      await auth.authStateReady();
      fb = { auth: auth, m: authMod };
      return fb;
    })();
    initPromise.catch(function () { initPromise = null; }); // allow retry after a failure
    return initPromise;
  }

  function authMessage(err) {
    var map = {
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/wrong-password": "Incorrect email or password.",
      "auth/user-not-found": "No account found for that email.",
      "auth/invalid-email": "That email address looks invalid.",
      "auth/email-already-in-use": "An account with that email already exists. Try signing in.",
      "auth/weak-password": "Choose a stronger password (at least 6 characters).",
      "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
      "auth/network-request-failed": "Network error. Check your connection and try again.",
      "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups for this site.",
      "auth/unauthorized-domain": "This domain is not authorised in Firebase (Authentication > Settings > Authorized domains).",
      "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase Authentication."
    };
    if (err && (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request")) { return ""; }
    return (err && map[err.code]) || (err && err.message) || "Something went wrong. Please try again.";
  }

  /* All page redirects go through here (one place to change; stubbed in tests). */
  function navigate(url, replace) {
    if (TEST.navigate) { TEST.navigate(url); return; }
    if (replace) { location.replace(url); } else { location.href = url; }
  }

  /* ================================================================ session */
  var session = null;

  function initials(name) {
    return String(name || "C F").trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join("");
  }
  function prettyName(email) {
    return String(email || "Citizen").split("@")[0].replace(/[._]/g, " ")
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  // The server speaks "user"/"admin"; the UI speaks "citizen"/"staff".
  function uiRole(role) { return role === "admin" ? "staff" : "citizen"; }

  function readCachedSession(uid) {
    try {
      var c = JSON.parse(sessionStorage.getItem(KEY_SESSION) || "null");
      if (c && c.uid === uid && Date.now() - c.cachedAt < SESSION_TTL) { return c; }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* Resolves the signed-in user's profile from GET /api/me (role comes from the server). */
  async function loadSession(force) {
    await init();
    var user = fb.auth.currentUser;
    if (!user) { session = null; sessionStorage.removeItem(KEY_SESSION); return null; }
    if (!force) {
      var cached = readCachedSession(user.uid);
      if (cached) { session = cached; return session; }
    } else {
      await user.getIdToken(true); // pick up freshly granted admin claims
    }
    var me = await api("/api/me");
    var name = me.name || user.displayName || prettyName(me.email || user.email);
    session = {
      uid: me.uid, email: me.email || user.email || "", name: name,
      role: uiRole(me.role), picture: me.picture || "", initials: initials(name),
      cachedAt: Date.now()
    };
    sessionStorage.setItem(KEY_SESSION, JSON.stringify(session));
    return session;
  }
  function getSession() { return session; }

  async function afterAuth() { return loadSession(true); }
  function signInGoogle() {
    // no await before the popup when sdk is ready => stays inside the click gesture
    function pop() { return fb.m.signInWithPopup(fb.auth, new fb.m.GoogleAuthProvider()); }
    return (fb ? pop() : init().then(pop)).then(afterAuth);
  }
  async function signInEmail(email, password) {
    await init();
    await fb.m.signInWithEmailAndPassword(fb.auth, email, password);
    return afterAuth();
  }
  async function signUpEmail(name, email, password) {
    await init();
    var cred = await fb.m.createUserWithEmailAndPassword(fb.auth, email, password);
    if (name) {
      await fb.m.updateProfile(cred.user, { displayName: name });
      await cred.user.getIdToken(true); // so the "name" claim reaches the server
    }
    return afterAuth();
  }
  async function resetPassword(email) {
    await init();
    await fb.m.sendPasswordResetEmail(fb.auth, email);
  }
  async function updateDisplayName(name) {
    await init();
    await fb.m.updateProfile(fb.auth.currentUser, { displayName: name });
    await fb.auth.currentUser.getIdToken(true);
    session = Object.assign({}, session, { name: name, initials: initials(name), cachedAt: Date.now() });
    sessionStorage.setItem(KEY_SESSION, JSON.stringify(session));
    return session;
  }
  async function logout() {
    session = null;
    sessionStorage.removeItem(KEY_SESSION);
    try { await init(); await fb.m.signOut(fb.auth); } catch (e) { /* already signed out */ }
  }

  /* Full-page message for unrecoverable load errors (offline, misconfigured…). */
  function fatal(msg) {
    var box = document.createElement("div");
    box.style.cssText = "max-width:520px;margin:12vh auto;padding:1.6rem;text-align:center;font-family:Inter,system-ui,sans-serif";
    box.innerHTML = '<div style="font-size:2.4rem">&#9888;&#65039;</div><h2 style="margin:.4rem 0">Can\u2019t load CivicFix</h2>' +
      '<p style="color:#64748b">' + escapeHtml(msg) + '</p>' +
      '<p><button class="btn btn-primary" onclick="location.reload()">Try again</button> ' +
      '<a class="btn btn-outline" href="index.html">Back to sign in</a></p>';
    document.body.innerHTML = "";
    document.body.appendChild(box);
  }

  /* Gate for protected pages. "staff" = admin only; "citizen" = any signed-in user. */
  async function requireAuth(want) {
    var s;
    try { s = await loadSession(); }
    catch (e) {
      if (e && e.code === "cf/not-configured") { navigate("index.html", true); return null; }
      if (e && e.status === 401) { return null; } // api() already redirected to login
      fatal(errText(e)); return null;
    }
    if (!s) { navigate("index.html", true); return null; }
    if (want === "staff" && s.role !== "staff") { navigate("dashboard.html", true); return null; }
    return s;
  }

  /* ================================================================= API */
  function errText(err) {
    if (!err) { return "Something went wrong."; }
    var d = err.details;
    if (d && typeof d === "object") {
      var parts = Object.keys(d).map(function (k) { return d[k]; });
      if (parts.length) { return parts.join(" "); }
    }
    return err.message || "Something went wrong.";
  }

  /* fetch wrapper: adds the Firebase ID token, parses JSON, throws Error{status, details}. */
  async function api(path, opts) {
    opts = opts || {};
    await init();
    var headers = { Accept: "application/json" };
    var user = fb.auth.currentUser;
    if (user) { headers.Authorization = "Bearer " + (await user.getIdToken()); }

    var url = (CFG.apiBase || "") + path;
    if (opts.query) {
      var sp = new URLSearchParams();
      Object.keys(opts.query).forEach(function (k) {
        var v = opts.query[k];
        if (v !== undefined && v !== null && v !== "") { sp.set(k, v); }
      });
      if (sp.toString()) { url += "?" + sp.toString(); }
    }
    var req = { method: opts.method || "GET", headers: headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      req.body = JSON.stringify(opts.body);
    }

    var res;
    try { res = await fetch(url, req); }
    catch (e) {
      var ne = new Error("Can\u2019t reach the server. Check your connection and try again.");
      ne.status = 0;
      throw ne;
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty / non-JSON body */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || ("Request failed (" + res.status + ")"));
      err.status = res.status;
      err.details = data && data.details;
      if (res.status === 401 && !opts.noAuthRedirect) {
        await logout();
        navigate("index.html", true);
      }
      throw err;
    }
    return data;
  }

  /* Issue endpoints ------------------------------------------------------ */
  function nearbyIssues(o) {   // nearest first; status: open | fixed | all
    return api("/api/issues", { query: { lat: o.lat, lng: o.lng, radiusKm: o.radiusKm, status: o.status || "all", limit: o.limit || 100 } });
  }
  function myIssues() { return api("/api/issues", { query: { mine: 1 } }); }
  function createIssue(d) { return api("/api/issues", { method: "POST", body: d }); }
  function adminIssues() { return api("/api/admin/issues"); }
  function patchIssue(id, body) { return api("/api/issues/" + encodeURIComponent(id), { method: "PATCH", body: body }); }
  function deleteIssue(id) { return api("/api/issues/" + encodeURIComponent(id), { method: "DELETE" }); }

  /* Uploads photos ({name, data: dataURL}) straight to Cloudinary using a server-signed request. */
  async function uploadPhotos(photos) {
    if (!photos || !photos.length) { return []; }
    var sig = await api("/api/upload-signature", { method: "POST" });
    var url = "https://api.cloudinary.com/v1_1/" + encodeURIComponent(sig.cloudName) + "/image/upload";
    return Promise.all(photos.map(async function (p) {
      var blob = await (await fetch(p.data)).blob();
      var fd = new FormData();
      fd.append("file", blob, p.name || "photo.jpg");
      fd.append("api_key", sig.apiKey);
      fd.append("timestamp", sig.timestamp);
      fd.append("signature", sig.signature);
      fd.append("folder", sig.folder);
      var res = await fetch(url, { method: "POST", body: fd });
      var j = null;
      try { j = await res.json(); } catch (e) { /* ignore */ }
      if (!res.ok || !j || !j.secure_url) {
        throw new Error((j && j.error && j.error.message) || "Photo upload failed. Please try again.");
      }
      return { url: j.secure_url, name: p.name || "" };
    }));
  }

  /* Smaller Cloudinary rendition for thumbnails (falls back to the original URL). */
  function thumb(url, w, h) {
    var marker = "/upload/";
    if (typeof url !== "string" || url.indexOf("https://res.cloudinary.com/") !== 0) { return url || ""; }
    var at = url.indexOf(marker);
    if (at < 0) { return url; }
    return url.slice(0, at + marker.length) + "c_fill,w_" + w + ",h_" + (h || w) + ",q_auto,f_auto/" +
           url.slice(at + marker.length);
  }

  /* Remembered "near me" location (UI preference only). */
  function getSavedLocation() {
    try { return JSON.parse(localStorage.getItem(KEY_LOC) || "null"); } catch (e) { return null; }
  }
  function saveLocation(loc) { try { localStorage.setItem(KEY_LOC, JSON.stringify(loc)); } catch (e) { /* ignore */ } }
  function fmtKm(km) {
    if (typeof km !== "number") { return ""; }
    return km < 1 ? Math.max(10, Math.round(km * 100) * 10) + " m" : km.toFixed(1) + " km";
  }

  /* ================================================================= utils */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function fmtDate(iso, withTime) {
    var d = new Date(iso);
    if (isNaN(d)) { return "—"; }
    var opt = { day: "2-digit", month: "short", year: "numeric" };
    if (withTime) { opt.hour = "2-digit"; opt.minute = "2-digit"; }
    return d.toLocaleDateString("en-GB", opt);
  }
  function timeAgo(iso) {
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(diff)) { return "—"; }
    if (diff < 60) { return "just now"; }
    if (diff < 3600) { return Math.floor(diff / 60) + " min ago"; }
    if (diff < 86400) { return Math.floor(diff / 3600) + " h ago"; }
    if (diff < 2592000) { return Math.floor(diff / 86400) + " d ago"; }
    return fmtDate(iso);
  }
  function catMeta(id) {
    var found = categories().filter(function (c) { return c.id === id; })[0];
    return found || { id: id, label: "Other", icon: ICONS.other };
  }
  function statusClass(status) {
    return ({ "New": "badge-new", "Assigned": "badge-assigned",
            "In Progress": "badge-progress", "Closed": "badge-closed" })[status] || "badge-new";
  }
  function badge(status) {
    return '<span class="badge ' + statusClass(status) + '">' + escapeHtml(status) + "</span>";
  }
  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  /* ================================================================ toasts */
  function toast(type, title, msg) {
    var wrap = $(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    var el = document.createElement("div");
    el.className = "toast " + (type === "ok" ? "ok" : type === "err" ? "err" : "");
    el.innerHTML = '<div style="font-size:1.05rem">' +
      (type === "ok" ? "\u2705" : type === "err" ? "\u26A0\uFE0F" : "\u2139\uFE0F") +
      "</div><div><strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(msg || "") + "</span></div>";
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity .25s ease, transform .25s ease";
      el.style.opacity = "0";
      el.style.transform = "translateX(20px)";
      setTimeout(function () { el.remove(); }, 260);
    }, 3600);
  }

  /* ================================================================ modals */
  function openModal(id) {
    var m = document.getElementById(id);
    if (!m) { return; }
    m.classList.add("open");
    document.body.style.overflow = "hidden";
    if (typeof m.__onOpen === "function") { m.__onOpen(); }
  }
  function closeModal(id) {
    var m = document.getElementById(id);
    if (!m) { return; }
    m.classList.remove("open");
    document.body.style.overflow = "";
  }
  function wireModals() {
    $$(".modal").forEach(function (m) {
      m.addEventListener("click", function (e) { if (e.target === m) { closeModal(m.id); } });
      $$("[data-close]", m).forEach(function (b) {
        b.addEventListener("click", function () { closeModal(m.id); });
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { $$(".modal.open").forEach(function (m) { closeModal(m.id); }); }
    });
  }

  /* =========================================== dropdown + shell scaffolding */
  function wireDropdowns() {
    $$(".dropdown").forEach(function (d) {
      var trigger = $("[data-toggle='dropdown']", d);
      if (!trigger) { return; }
      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        d.classList.toggle("open");
      });
    });
    document.addEventListener("click", function () {
      $$(".dropdown.open").forEach(function (d) { d.classList.remove("open"); });
    });
  }
  function paintShell() {
    var s = getSession();
    if (!s) { return; }
    $$("[data-user-name]").forEach(function (el) { el.textContent = s.name; });
    $$("[data-user-email]").forEach(function (el) { el.textContent = s.email; });
    $$("[data-user-initials]").forEach(function (el) { el.textContent = s.initials || initials(s.name); });
    $$("[data-role-only]").forEach(function (el) {
      el.classList.toggle("hidden", el.getAttribute("data-role-only") !== s.role);
    });
    $$("[data-logout]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        logout().then(function () { navigate("index.html"); });
      });
    });
  }

  /* ==================================================== image file reading */
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error("read failed")); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("decode failed")); };
        img.onload = function () {
          var max = 1000, w = img.width, h = img.height;
          if (w > max || h > max) {
            var r = Math.min(max / w, max / h);
            w = Math.round(w * r); h = Math.round(h * r);
          }
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve({ name: file.name, data: c.toDataURL("image/jpeg", 0.72) });
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ======================================================== Leaflet + geo */
  var GMAPS_TILES = "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";
  var GMAPS_ATTR  = '&copy; Google Maps';

  function makeMap(el, center, zoom, opts) {
    opts = opts || {};
    var map = global.L.map(el, { scrollWheelZoom: !!opts.scrollWheelZoom }).setView(
      [center.lat, center.lng], zoom || 14
    );
    var tiles = global.L.tileLayer(GMAPS_TILES, { 
      maxZoom: 20, 
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], 
      attribution: GMAPS_ATTR 
    });

    var broken = 0, warned = false;
    tiles.on("tileerror", function () {
      broken++;
      if (warned || broken < 4) { return; }
      warned = true;
      var box = (typeof el === "string") ? document.getElementById(el) : el;
      if (!box || box.querySelector(".map-fallback")) { return; }
      var ov = document.createElement("div");
      ov.className = "map-fallback";
      ov.innerHTML = '<strong>&#128506;&#65039; Basemap tiles unavailable</strong>' +
        "<span>No connection to the tile server. The map still works — click anywhere to drop a pin." +
        "</span>";
      box.appendChild(ov);
    });

    tiles.addTo(map);
    return map;
  }
  function pinIcon(color, label) {
    var bg = color || "#1d4ed8";
    return global.L.divIcon({
      className: "",
      html: '<div style="display:grid;place-items:center;width:28px;height:28px;border-radius:50% 50% 50% 6px;' +
            "transform:rotate(-45deg);background:" + bg + ";box-shadow:0 4px 10px rgba(15,23,42,.35);" +
            'border:2px solid #fff"><span style="transform:rotate(45deg);font-size:12px">' +
            (label || "") + "</span></div>",
      iconSize: [28, 28],
      iconAnchor: [14, 26]
    });
  }
  function geocode(query) {
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
              encodeURIComponent(query);
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) { return r.json(); });
  }
  function reverseGeocode(lat, lng) {
    var url = "https://nominatim.openstreetmap.org/reverse?format=json&lat=" + lat + "&lon=" + lng;
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) { return r.json(); });
  }
  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) { reject(new Error("Geolocation unsupported")); return; }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, timeout: 10000, maximumAge: 0
      });
    });
  }

  /* ============================================================== exports */
  global.CF = {
    STATUSES: STATUSES,
    // config + auth + session
    loadConfig: loadConfig, categories: categories, teams: teams, defaultCenter: defaultCenter,
    firebaseConfigured: firebaseConfigured, init: init, authMessage: authMessage,
    loadSession: loadSession, getSession: getSession, requireAuth: requireAuth,
    signInGoogle: signInGoogle, signInEmail: signInEmail, signUpEmail: signUpEmail,
    resetPassword: resetPassword, updateDisplayName: updateDisplayName, logout: logout,
    initials: initials, fatal: fatal, navigate: navigate,
    // API
    api: api, errText: errText, nearbyIssues: nearbyIssues, myIssues: myIssues,
    createIssue: createIssue, adminIssues: adminIssues, patchIssue: patchIssue,
    deleteIssue: deleteIssue, uploadPhotos: uploadPhotos, thumb: thumb,
    getSavedLocation: getSavedLocation, saveLocation: saveLocation, fmtKm: fmtKm,
    // UI helpers
    $: $, $$: $$, escapeHtml: escapeHtml, fmtDate: fmtDate, timeAgo: timeAgo,
    catMeta: catMeta, statusClass: statusClass, badge: badge, qs: qs,
    toast: toast, openModal: openModal, closeModal: closeModal,
    wireModals: wireModals, wireDropdowns: wireDropdowns, paintShell: paintShell,
    readImage: readImage,
    makeMap: makeMap, pinIcon: pinIcon, geocode: geocode,
    reverseGeocode: reverseGeocode, getPosition: getPosition,
    STATUS_COLORS: { "New": "#b45309", "Assigned": "#6d28d9", "In Progress": "#1d4ed8", "Closed": "#0f9d58" }
  };
})(window);