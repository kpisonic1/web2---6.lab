const express = require("express");
const path = require("path");
const fs = require("fs");
const fse = require("fs-extra");
const multer = require("multer");
const webpush = require("web-push");

const app = express();
const PORT = process.env.PORT || 3000;


app.use(express.json());
app.use(express.static(__dirname));

//definiraj sve putanje odjednom
const PATHS = {
  puppyClassDir: path.join(__dirname, "puppyClass"),
  sessionsDir: path.join(__dirname, "sessions"),
  subscriptionsFile: path.join(__dirname, "subscriptions.json")
};

//uploadane slike iz puppy class
app.use("/puppyClass", express.static(PATHS.puppyClassDir));

//provjera postoje li putanje, ako ne, kreiraj ih
fse.ensureDirSync(PATHS.puppyClassDir);
fse.ensureDirSync(PATHS.sessionsDir);

//kreiraj prazan subscriptions file ako ne postoji
if (!fs.existsSync(PATHS.subscriptionsFile)) {
  fs.writeFileSync(PATHS.subscriptionsFile, "[]", "utf-8");
}

//kako ce uploadane slike biti spremljene
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PATHS.puppyClassDir),
    filename: (_req, file, cb) => cb(null, file.originalname.replaceAll(":", "-"))
  })
});

//citanje push authentication keys spremljenih u env vars i konfiguracija
const { VAPID_PUBLIC_KEY = "", VAPID_PRIVATE_KEY = "" } = process.env;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:karla.pisonic@fer.hr",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn("VAPID keys missing. Push notifications will NOT work yet.");
}

//citanje svih spremljenih subscrip
function readSubscriptions() {
  try {
    return JSON.parse(fs.readFileSync(PATHS.subscriptionsFile, "utf-8"));
  } catch {
    return [];
  }
}

//upis subscrip natrag na disk
function saveSubscriptions(subs) {
  fs.writeFileSync(PATHS.subscriptionsFile, JSON.stringify(subs, null, 2), "utf-8");
}

async function sendPushToAll(message) {
  //ao vapid nije konfiguriran ne cini nista
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const subs = readSubscriptions();
  const stillValid = [];

  const payload = JSON.stringify({
    title: "Puppy Yoga",
    body: message,
    redirectUrl: "/index.html"
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      stillValid.push(sub);
    } catch {
      // invalid subscription removed
    }
  }

  saveSubscriptions(stillValid);
}


app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

//provjera je li postavljeno na online
app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get("/api/publicKey", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

//prima push subscrip od browsera i sprema ga ukoliko nije spremljeno
app.post("/api/subscriptions", (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "Invalid subscription" });

  const subs = readSubscriptions();
  const exists = subs.some((s) => s.endpoint === sub.endpoint);

  if (!exists) subs.push(sub);
  saveSubscriptions(subs);

  res.json({ success: true });
});

//dohvat svih sessiona
app.get("/api/sessions", (_req, res) => {
  try {
    const files = fs.readdirSync(PATHS.sessionsDir).filter((f) => f.endsWith(".json"));
    const sessions = files.map((f) =>
      JSON.parse(fs.readFileSync(path.join(PATHS.sessionsDir, f), "utf-8"))
    );

    sessions.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
    res.json(sessions);
  } catch {
    res.json([]);
  }
});

//funkcionalnosti za spremanje sessiona
function buildSession(body, file) {
  return {
    id: body.id,
    ts: body.ts || new Date().toISOString(),
    breed: body.breed || "Unknown breed",
    notes: body.notes || "",
    photoPath: "/puppyClass/" + file.filename
  };
}

function sessionFilename(id) {
  return path.join(
    PATHS.sessionsDir,
    `${Date.now()}_${id.replace(/[^a-z0-9_-]/gi, "")}.json`
  );
}

app.post("/api/sessions", upload.single("sessionPhoto"), async (req, res) => {
  try {
    if (!req.body?.id || !req.file) {
      return res.status(400).json({ success: false });
    }

    const session = buildSession(req.body, req.file);
    const filename = sessionFilename(req.body.id);

    fs.writeFileSync(filename, JSON.stringify(session, null, 2), "utf-8");

    await sendPushToAll(`Session synced (${session.breed})`);

    res.json({ success: true, id: session.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


app.get("/api/testPush", async (_req, res) => {
  await sendPushToAll("Test push notification");
  res.json({ success: true });
});


app.listen(PORT, "0.0.0.0");


