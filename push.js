/* funkcija koja pretvara string base64 encoded, odnosno VAPID public key u Uint8Arr */
function urlBase64ToUint8Array(base64String) {
  const padLen = (4 - (base64String.length % 4)) % 4;
  const padded = base64String + "=".repeat(padLen);
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");

  const raw = atob(normalized);
  const arr = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

/* funkcija koja vraca aktivnu sw registraciju (jer push subscr pripadaju sw, a ne stranici) */
async function getRegistration() {
  if (!navigator.serviceWorker) return null;
  return navigator.serviceWorker.ready;
}

/* funkcija s kojom se provjerava podrzava li browser APIje za push - sw, notif, pushmanager */
export function supportsPush() {
  const support = {
    hasSW: !!navigator.serviceWorker,
    hasNotif: "Notification" in globalThis,
    hasPush: "PushManager" in globalThis
  };

  return { ...support, ok: support.hasSW && support.hasNotif && support.hasPush };
}

/* funkcija kojom provjeravam je li korisnik ima vec subscri na push */
export async function getPushSubscription() {
  if (!navigator.serviceWorker) return null;
  if (!("PushManager" in globalThis)) return null;

  const reg = await getRegistration();
  if (!reg) return null;

  return reg.pushManager.getSubscription();
}

/* funkcija koja omogucuje push */
export async function enablePush() {
  try {
    const support = supportsPush();

    if (!support.hasSW) return { ok: false, reason: "no-service-worker" };
    if (!support.hasPush) return { ok: false, reason: "no-pushmanager" };
    if (!support.hasNotif) return { ok: false, reason: "no-notification-api" };

    /* pitaj browser za dopustenje prije slanja notifa */
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { ok: false, reason: "permission-denied" };
    }

    const reg = await getRegistration();
    if (!reg) return { ok: false, reason: "no-registration" };

    /* ✅ FIX #2: if already subscribed, do NOT subscribe again */
    const existingSub = await reg.pushManager.getSubscription();
    if (existingSub) {
      return { ok: true, already: true };
    }

    const keyResponse = await fetch("/api/publicKey");
    if (!keyResponse.ok) {
      return { ok: false, reason: "publickey-endpoint-failed" };
    }

    const keyData = await keyResponse.json();
    if (!keyData.publicKey) {
      return {
        ok: false,
        reason: "missing-vapid-on-server",
        detail: "Set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY in server env."
      };
    }

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
    });

    const saveResponse = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription)
    });

    if (!saveResponse.ok) {
      return { ok: false, reason: "save-subscription-failed" };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "exception",
      detail: err?.message || String(err)
    };
  }
}

/* funkcija s ciljom micanja pretplate browsera na push */
export async function disablePush() {
  try {
    const sub = await getPushSubscription();
    if (!sub) return { ok: true, already: true };

    await sub.unsubscribe();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "unsubscribe-failed",
      detail: err?.message || String(err)
    };
  }
}
