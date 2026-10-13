/* ==========================================================================
   CivicFix — shared application logic (vanilla JS, zero dependencies)
   Handles: mock auth, localStorage data store, UI helpers, toasts, modals,
            image previews, Leaflet map helpers, geocoding.
   ========================================================================== */
(function (global) {
  "use strict";

  var KEY_ISSUES  = "civicfix.issues.v1";
  var KEY_SESSION = "civicfix.session.v1";
  var STATUSES    = ["New", "Assigned", "In Progress", "Closed"];

  /* ============================================================== storage */
  function seed(force) {
    var cur = null;
    try { cur = JSON.parse(localStorage.getItem(KEY_ISSUES) || "null"); } catch (e) { cur = null; }
    if (!cur || !cur.length || force) {
      localStorage.setItem(KEY_ISSUES, JSON.stringify(global.MOCK.issues));
    }
  }
  function getIssues() {
    try { return JSON.parse(localStorage.getItem(KEY_ISSUES) || "[]"); } catch (e) { return []; }
  }
  function saveIssues(list) { localStorage.setItem(KEY_ISSUES, JSON.stringify(list)); }
  function getIssue(id) {
    var l = getIssues();
    for (var i = 0; i < l.length; i++) { if (l[i].id === id) return l[i]; }
    return null;
  }
  function nextId() {
    var max = 1000;
    getIssues().forEach(function (x) {
      var n = parseInt(String(x.id).replace(/\D/g, ""), 10);
      if (!isNaN(n) && n > max) { max = n; }
    });
    return "CF-" + (max + 1);
  }
  function addIssue(data) {
    var s = getSession();
    var now = new Date().toISOString();
    var issue = {
      id: nextId(),
      title: data.title,
      category: data.category,
      priority: data.priority || "Medium",
      status: "New",
      team: "",
      description: data.description || "",
      address: data.address || "",
      lat: data.lat,
      lng: data.lng,
      createdAt: now,
      reporter: s ? s.email : "citizen@demo.gov",
      photos: data.photos || [],
      notes: [],
      history: [{ status: "New", at: now }]
    };
    var list = getIssues();
    list.unshift(issue);
    saveIssues(list);
    return issue;
  }
  function updateIssue(id, patch) {
    var out = null;
    var list = getIssues().map(function (x) {
      if (x.id !== id) { return x; }
      out = Object.assign({}, x, patch);
      return out;
    });
    saveIssues(list);
    return out;
  }
  function setStatus(id, status, note) {
    var now = new Date().toISOString();
    var out = null;
    var list = getIssues().map(function (x) {
      if (x.id !== id) { return x; }
      out = Object.assign({}, x, { status: status });
      out.history = (x.history || []).concat([{ status: status, at: now }]);
      if (note) { out.notes = (x.notes || []).concat([{ at: now, by: "Ops Desk", text: note }]); }
      return out;
    });
    saveIssues(list);
    return out;
  }
  function addNote(id, text, by) {
    var now = new Date().toISOString();
    var out = null;
    var list = getIssues().map(function (x) {
      if (x.id !== id) { return x; }
      out = Object.assign({}, x, { notes: (x.notes || []).concat([{ at: now, by: by || "Ops Desk", text: text }]) });
      return out;
    });
    saveIssues(list);
    return out;
  }
  function assignTeam(id, team, priority) {
    var now = new Date().toISOString();
    var out = null;
    var list = getIssues().map(function (x) {
      if (x.id !== id) { return x; }
      out = Object.assign({}, x, { team: team, priority: priority || x.priority });
      if (x.status === "New") {
        out.status = "Assigned";
        out.history = (x.history || []).concat([{ status: "Assigned", at: now }]);
      }
      return out;
    });
    saveIssues(list);
    return out;
  }

  /* ============================================================== session */
  function getSession() {
    try { return JSON.parse(localStorage.getItem(KEY_SESSION) || "null"); } catch (e) { return null; }
  }
  function initials(name) {
    return String(name || "C F").trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join("");
  }
  function login(role, email, name) {
    var s = {
      email: email || (role === "staff" ? "ops@city.gov" : "citizen@demo.gov"),
      name: name || (role === "staff" ? "Ops Controller" : "Aarav Menon"),
      role: role || "citizen",
      at: new Date().toISOString()
    };
    s.initials = initials(s.name);
    localStorage.setItem(KEY_SESSION, JSON.stringify(s));
    return s;
  }
  function logout() { localStorage.removeItem(KEY_SESSION); }

  /* Redirects to login when signed out, or to the right console for the role. */
  function requireAuth(want) {
    var s = getSession();
    if (!s) { location.replace("index.html"); return null; }
    if (want && s.role !== want) {
      location.replace(s.role === "staff" ? "admin.html" : "dashboard.html");
      return null;
    }
    return s;
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
    var found = global.MOCK.categories.filter(function (c) { return c.id === id; })[0];
    return found || { id: id, label: "Other", icon: "\uD83D\uDCCD" };
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
        logout();
        location.href = "index.html";
      });
    });
  }

  /* ==================================================== image file reading */
  /* Reads a File, downscales it on a canvas, returns a small JPEG data URL. */
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
  /* Swap-in note: to use the Google Maps JavaScript API instead, replace
     makeMap() with new google.maps.Map(el, {...}) plus a google.maps.Marker,
     and swap geocode()/reverseGeocode() for the Geocoding API. A Google map
     rendered without a billed API key shows a "for development purposes only"
     watermark, which is why this prototype ships with Leaflet + OSM. */
  var OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  var OSM_ATTR  = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  function makeMap(el, center, zoom, opts) {
    opts = opts || {};
    var map = global.L.map(el, { scrollWheelZoom: !!opts.scrollWheelZoom }).setView(
      [center.lat, center.lng], zoom || 14
    );
    var tiles = global.L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTR });

    /* If the tile server is unreachable (offline demo, blocked network, or a
       strict referrer policy) the grid would render as empty grey squares.
       Drop a friendly overlay on top so the map never looks broken. */
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
    seed: seed, getIssues: getIssues, saveIssues: saveIssues, getIssue: getIssue,
    nextId: nextId, addIssue: addIssue, updateIssue: updateIssue, setStatus: setStatus,
    addNote: addNote, assignTeam: assignTeam,
    getSession: getSession, login: login, logout: logout, requireAuth: requireAuth,
    initials: initials,
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
