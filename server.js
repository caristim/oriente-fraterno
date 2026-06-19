// ==========================================
// SERVIDOR - ORIENTE FRATERNO 148
// Sirve la app estática + envía push diarios
// ==========================================

const express  = require('express');
const webpush  = require('web-push');
const cron     = require('node-cron');
const path     = require('path');
const fetch    = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app  = express();
const PORT = 5000;

// ── VAPID ────────────────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY  = 'BNrCEJzq3O8KEEELwyOeRiHQU3911ptH6DYQ_2JuqYXim68Hw12IUfd8Z9dfz9kCEgyNKrNzPLrm0hzrz9UORKI';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PRIVATE_KEY) {
  console.error('[Push] ⚠️  VAPID_PRIVATE_KEY no configurada. Las notificaciones en background no funcionarán.');
} else {
  webpush.setVapidDetails(
    'mailto:admin@orientefraterno148.app',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  console.log('[Push] ✅ VAPID configurado.');
}

// ── Firebase config (Firestore REST API) ─────────────────────────────────────
const FIREBASE_API_KEY = 'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8';
const PROJECT_ID       = 'orientefraterno148-2a0c1';
const FIRESTORE_BASE   = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── Utilidades Firestore REST ─────────────────────────────────────────────────
async function firestoreGetAll(collection) {
  const url = `${FIRESTORE_BASE}/${collection}?key=${FIREBASE_API_KEY}&pageSize=300`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Firestore ${collection}: ${res.status}`);
  const json = await res.json();
  return (json.documents || []).map(docToObj);
}

function docToObj(doc) {
  const fields = doc.fields || {};
  const obj = { _id: (doc.name || '').split('/').pop() };
  for (const [k, v] of Object.entries(fields)) {
    obj[k] = parseFirestoreValue(v);
  }
  return obj;
}

function parseFirestoreValue(v) {
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.integerValue  !== undefined) return Number(v.integerValue);
  if (v.doubleValue   !== undefined) return Number(v.doubleValue);
  if (v.booleanValue  !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.nullValue     !== undefined) return null;
  if (v.mapValue)    return docToObj({ fields: v.mapValue.fields || {}, name: '' });
  if (v.arrayValue)  return (v.arrayValue.values || []).map(parseFirestoreValue);
  return null;
}

// ── Lógica de eventos ─────────────────────────────────────────────────────────
function getMonth(iso) {
  const p = String(iso).split('-');
  return p.length === 2 ? +p[0] : p.length === 3 ? +p[1] : null;
}
function getDay(iso) {
  const p = String(iso).split('-');
  return p.length === 2 ? +p[1] : p.length === 3 ? +p[2] : null;
}
function emojiForTipo(tipo) {
  return { 'Cumpleaños':'🎂','Fecha de casamiento':'💍','Aniversario':'🌹','Pasaje al Oriente Eterno':'✦' }[tipo] || '📅';
}

function matchesToday(iso) {
  const now = new Date();
  return getMonth(iso) === now.getMonth()+1 && getDay(iso) === now.getDate();
}
function matchesTomorrow(iso) {
  const tm  = new Date(); tm.setDate(tm.getDate()+1);
  return getMonth(iso) === tm.getMonth()+1 && getDay(iso) === tm.getDate();
}

// ── Envío de notificaciones ───────────────────────────────────────────────────
async function sendPushToAll(payload) {
  if (!VAPID_PRIVATE_KEY) {
    console.warn('[Push] Sin VAPID_PRIVATE_KEY, omitiendo envío.');
    return;
  }

  let subscriptions = [];
  try { subscriptions = await firestoreGetAll('webpush_subscriptions'); }
  catch(e) { console.error('[Push] Error leyendo suscripciones:', e.message); return; }

  if (!subscriptions.length) {
    console.log('[Push] Sin suscripciones registradas todavía.');
    return;
  }

  console.log(`[Push] Enviando a ${subscriptions.length} dispositivos:`, payload.title);

  const results = await Promise.allSettled(
    subscriptions.map(sub => {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      return webpush.sendNotification(pushSub, JSON.stringify(payload))
        .then(() => ({ ok: true, ep: sub.endpoint.slice(-20) }))
        .catch(async err => {
          const code = err.statusCode || err.status || '?';
          console.warn(`[Push] Falló (HTTP ${code}): ${err.message} | endpoint: ...${sub.endpoint.slice(-30)}`);
          // HTTP 410 = suscripción expirada → eliminar de Firestore automáticamente
          if (code === 410) {
            try {
              const delUrl = `${FIRESTORE_BASE}/webpush_subscriptions/${sub._id}?key=${FIREBASE_API_KEY}`;
              await fetch(delUrl, { method: 'DELETE' });
              console.log(`[Push] Suscripción expirada eliminada: ${sub._id}`);
            } catch(e) { console.warn('[Push] Error eliminando suscripción expirada:', e.message); }
          }
          return { ok: false, ep: sub.endpoint.slice(-20), err: err.message };
        });
    })
  );

  const ok  = results.filter(r => r.value && r.value.ok).length;
  const bad = results.length - ok;
  console.log(`[Push] Resultado: ${ok} enviados, ${bad} fallidos.`);
}

// ── Job principal ─────────────────────────────────────────────────────────────
async function checkAndNotify() {
  console.log('[Cron] Verificando eventos del día...');
  let eventos = [];
  try { eventos = await firestoreGetAll('eventos'); }
  catch(e) { console.error('[Cron] Error leyendo eventos:', e.message); return; }

  const hoy     = eventos.filter(ev => ev.fecha && matchesToday(ev.fecha));
  const maniana = eventos.filter(ev => ev.fecha && matchesTomorrow(ev.fecha));

  console.log(`[Cron] Eventos hoy: ${hoy.length}, mañana: ${maniana.length}`);

  if (hoy.length) {
    const lista = hoy.map(ev => `${emojiForTipo(ev.tipo)} ${ev.nombre}`).join('\n');
    await sendPushToAll({
      title: 'Oriente Fraterno · 148',
      body:  hoy.length === 1
        ? `${emojiForTipo(hoy[0].tipo)} Hoy: ${hoy[0].tipo} de ${hoy[0].nombre}`
        : `📅 Hoy hay ${hoy.length} eventos:\n${lista}`,
      url:   '/',
      tag:   `hoy-${new Date().toISOString().slice(0,10)}`,
    });
  }

  if (maniana.length) {
    const lista = maniana.map(ev => `${emojiForTipo(ev.tipo)} ${ev.nombre}`).join('\n');
    await sendPushToAll({
      title: 'Oriente Fraterno · 148',
      body:  maniana.length === 1
        ? `${emojiForTipo(maniana[0].tipo)} Mañana: ${maniana[0].tipo} de ${maniana[0].nombre}`
        : `📅 Mañana hay ${maniana.length} eventos:\n${lista}`,
      url:   '/',
      tag:   `maniana-${new Date().toISOString().slice(0,10)}`,
    });
  }

  if (!hoy.length && !maniana.length) {
    console.log('[Cron] Sin eventos para notificar.');
  }
}

// ── Cron: todos los días a las 9:00 AM (hora Uruguay UTC-3) ──────────────────
// 9:00 AM UYT = 12:00 UTC = "0 12 * * *"
cron.schedule('0 12 * * *', () => {
  console.log('[Cron] ⏰ Job diario disparado (9:00 AM Uruguay)');
  checkAndNotify();
}, { timezone: 'UTC' });

// ── Endpoint manual para probar sin esperar el cron ──────────────────────────
app.get('/api/test-push', async (req, res) => {
  console.log('[API] Prueba manual de notificación solicitada');
  try {
    await checkAndNotify();
    res.json({ ok: true, message: 'Push procesado. Revisá la consola del servidor.' });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Endpoint de estado ────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  let subs = 0, events = 0;
  try { subs   = (await firestoreGetAll('webpush_subscriptions')).length; } catch(_) {}
  try { events = (await firestoreGetAll('eventos')).length; } catch(_) {}
  res.json({
    vapidConfigured: !!VAPID_PRIVATE_KEY,
    subscriptions:   subs,
    events,
    nextCron:        '09:00 Uruguay (12:00 UTC) daily',
  });
});

// ── Archivos estáticos ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Arranque ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] ✅ Escuchando en http://0.0.0.0:${PORT}`);
  console.log(`[Server] 📋 Estado:    GET /api/status`);
  console.log(`[Server] 🔔 Test push: GET /api/test-push`);
  // Verificar al iniciar si hay eventos hoy
  checkAndNotify();
});
