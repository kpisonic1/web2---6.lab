import { del, entries } from "/idb.js";

const CACHENAME = "puppy-yoga-cache-v8";

const APPSHELL = [
  "/",
  "/index.html",
  "/addsession.html",
  "/offline.html",
  "/404.html",
  "/manifest.json",
  "/styles/styles.css",
  "/push.js",
  "/idb.js",
  "/img/android/android-launchericon-192-192.png",
  "/img/android/android-launchericon-512-512.png"
];

//implementira precache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHENAME).then((cache) => cache.addAll(APPSHELL))
  );
  self.skipWaiting();
});

//procita sve cache names, obrise one koje nisu u trenutnom cacheu
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHENAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

//uvjet zadatka: pokazati caching strategy: network-only, network-first, cache-first
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const { pathname } = new URL(req.url);

  if (pathname === "/api/ping") {
    return event.respondWith(networkOnly(req));
  }

  if (pathname.startsWith("/api/")) {
    return event.respondWith(handleApi(req));
  }

  if (req.mode === "navigate") {
    return event.respondWith(handleNavigate(req));
  }

  return event.respondWith(handleAsset(req));
});

const networkOnly = async (req) => {
  try {
    const response = await fetch(req);
    return response;
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};

//funkcija koja pokazuje caching stategy w/ cache fallback
async function handleApi(req) {
  const cache = await caches.open(CACHENAME);

  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;

    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}

//funkcija koja handlea stranicu i kad je online i kad je offline status
async function handleNavigate(req) {
  const cache = await caches.open(CACHENAME);
  const pathname = new URL(req.url).pathname;

  const cachedPage =
    (await caches.match(req, { ignoreSearch: true })) ||
    (await caches.match(pathname));

  try {
    const res = await fetch(req);
    if (res?.ok) {
      cache.put(req, res.clone());
      return res;
    }

    
    if (cachedPage) return cachedPage;

    const cached404 = await caches.match("/404.html");
    return cached404 || res;
  } catch {
    //offline ili je fetch failao
    if (cachedPage) return cachedPage;

    const offline = await caches.match("/offline.html");
    if (offline) return offline;

    const home = await caches.match("/index.html");
    if (home) return home;

    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

//funkcija koja prvo provjerava cache , ako je pronadjen odmah ga vrati, 
//a ako nije, provjeri sa networka i cacheaj
async function handleAsset(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHENAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return caches.match("/offline.html");
  }
}

//uvjet zadatka: background sync - synca sve session dodane dok je status bio offline
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-sessions") {
    event.waitUntil(syncQueuedSessions());
  }
});

//uploadaj sve sessione sa idb koji su napravljeni za vrijeme offlinea
async function syncQueuedSessions() {
  const allItems = await entries();

  for (const [key, session] of allItems) {
    try {
      const fd = new FormData();
      fd.append("id", session.id);
      fd.append("ts", session.ts);
      fd.append("breed", session.breed);
      fd.append("notes", session.notes);
      fd.append("sessionPhoto", session.imageBlob, session.id + ".png");

      const res = await fetch("/api/sessions", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      await del(data.id);
    } catch {
      // keep queued
    }
  }
}

//uvjet zadatka: push notif
self.addEventListener("push", (event) => {
  let data = { title: "Puppy Yoga", body: "Hello!", redirectUrl: "/index.html" };
  if (event.data) {
    try { data = JSON.parse(event.data.text()); } catch {}
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { redirectUrl: data.redirectUrl }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const url = event.notification?.data?.redirectUrl || "/index.html";
  event.notification.close();
  event.waitUntil(clients.openWindow(url));
});
