#!/usr/bin/env node
// scripts/enviar-notificaciones.js
// Script que se ejecuta diariamente vía GitHub Actions

const webpush = require('web-push');
const https = require('https');

// ── Configuración ──────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = 'BNrCEJzq3O8KEEELwyOeRiHQU3911ptH6DYQ_2JuqYXim68Hw12IUfd8Z9dfz9kCEgyNKrNzPLrm0hzrz9UORKI';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PRIVATE_KEY) {
  console.error('❌ VAPID_PRIVATE_KEY no configurada como secreto en GitHub');
  process.exit(1);
}

webpush.setVapidDetails(
  'mailto:admin@orientefraterno148.app',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// ── Configuración Firebase ──────────────────────────────────────
const PROJECT_ID = 'orientefraterno148-2a0c1';
const API_KEY = 'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── Helpers para Firestore REST API ─────────────────────────────
function firestoreGet(collection) {
  return new Promise((resolve, reject) => {
    const url = `${FIRESTORE_BASE}/${collection}?key=${API_KEY}&pageSize=300`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`Firestore error: ${json.error.message}`));
          } else {
            resolve(json.documents || []);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function parseFirestoreDoc(doc) {
  const fields = doc.fields || {};
  const result = { id: doc.name.split('/').pop() };
  
  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) result[key] = value.stringValue;
    else if (value.integerValue !== undefined) result[key] = Number(value.integerValue);
    else if (value.doubleValue !== undefined) result[key] = Number(value.doubleValue);
    else if (value.booleanValue !== undefined) result[key] = value.booleanValue;
    else if (value.timestampValue !== undefined) result[key] = value.timestampValue;
  }
  return result;
}

function firestoreDelete(docName) {
  return new Promise((resolve) => {
    const url = `https://firestore.googleapis.com/v1/${docName}?key=${API_KEY}`;
    const req = https.request(url, { method: 'DELETE' }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', () => resolve());
    req.end();
  });
}

// ── Lógica de eventos ────────────────────────────────────────────
function getTodayDate() {
  const now = new Date();
  // Uruguay está en UTC-3
  const uyTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const month = String(uyTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(uyTime.getUTCDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function getTomorrowDate() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const uyTime = new Date(tomorrow.getTime() - 3 * 60 * 60 * 1000);
  const month = String(uyTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(uyTime.getUTCDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function getEmojiForTipo(tipo) {
  const map = {
    'Cumpleaños': '🎂',
    'Fecha de casamiento': '💍',
    'Aniversario': '🌹',
    'Pasaje al Oriente Eterno': '✦'
  };
  return map[tipo] || '📅';
}

// ── Envío de notificaciones ──────────────────────────────────────
async function sendNotification(subscription, title, body, tag) {
  try {
    const payload = JSON.stringify({
      title,
      body,
      url: 'https://caristim.github.io/oriente-fraterno/',
      tag,
    });
    
    await webpush.sendNotification(subscription, payload, {
      TTL: 86400, // 24 horas
      urgency: 'high',
    });
    
    console.log(`✅ Enviado a: ${subscription.endpoint.substring(0, 50)}...`);
    return { success: true };
  } catch (error) {
    const isInvalid = error.statusCode === 404 || error.statusCode === 410;
    console.log(`❌ Falló (${error.statusCode || 'unknown'}): ${isInvalid ? 'suscripción inválida' : error.message}`);
    return { success: false, invalid: isInvalid, endpoint: subscription.endpoint };
  }
}

// ── MAIN ──────────────────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔔 Oriente Fraterno 148 - Notificador Diario');
  console.log(`📅 Fecha hoy: ${getTodayDate()}`);
  console.log(`📅 Fecha mañana: ${getTomorrowDate()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Obtener eventos
  console.log('\n📖 Leyendo eventos de Firestore...');
  let eventosDocs = [];
  try {
    eventosDocs = await firestoreGet('eventos');
  } catch (error) {
    console.error('❌ Error leyendo eventos:', error.message);
    process.exit(1);
  }

  const eventos = eventosDocs.map(parseFirestoreDoc);
  console.log(`📊 Total eventos: ${eventos.length}`);

  const hoy = eventos.filter(e => e.fecha === getTodayDate());
  const manana = eventos.filter(e => e.fecha === getTomorrowDate());

  if (hoy.length === 0 && manana.length === 0) {
    console.log('\n✨ No hay eventos para hoy o mañana. Fin.');
    return;
  }

  // 2. Obtener suscripciones
  console.log('\n📖 Leyendo suscripciones Web Push...');
  let subDocs = [];
  try {
    subDocs = await firestoreGet('webpush_subscriptions');
  } catch (error) {
    console.error('❌ Error leyendo suscripciones:', error.message);
    process.exit(1);
  }

  const subscriptions = subDocs.map(parseFirestoreDoc)
    .filter(s => s.endpoint && s.p256dh && s.auth);

  console.log(`📱 Dispositivos registrados: ${subscriptions.length}`);

  if (subscriptions.length === 0) {
    console.log('\n⚠️ No hay dispositivos registrados para notificar.');
    console.log('💡 Los usuarios deben abrir la app y activar notificaciones.');
    return;
  }

  // 3. Enviar notificaciones
  console.log('\n📨 Enviando notificaciones...');

  const eventosParaNotificar = [...hoy, ...manana];
  const invalidEndpoints = [];

  for (const evento of eventosParaNotificar) {
    const isHoy = hoy.includes(evento);
    const cuando = isHoy ? 'Hoy' : 'Mañana';
    const emoji = getEmojiForTipo(evento.tipo);
    const title = 'Oriente Fraterno · 148';
    const body = `${emoji} ${cuando}: ${evento.tipo} de ${evento.nombre}`;
    const tag = `evento-${evento.id || Date.now()}`;

    console.log(`\n📌 ${body}`);

    for (const sub of subscriptions) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      const result = await sendNotification(pushSub, title, body, tag);
      if (result.invalid) {
        invalidEndpoints.push(sub.id);
      }
    }
  }

  // 4. Limpiar suscripciones inválidas
  if (invalidEndpoints.length > 0) {
    console.log(`\n🧹 Eliminando ${invalidEndpoints.length} suscripciones inválidas...`);
    for (const id of invalidEndpoints) {
      try {
        await firestoreDelete(`projects/${PROJECT_ID}/databases/(default)/documents/webpush_subscriptions/${id}`);
        console.log(`✅ Eliminada: ${id}`);
      } catch (error) {
        console.log(`⚠️ No se pudo eliminar: ${id}`);
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Proceso completado. Notificaciones enviadas: ${eventosParaNotificar.length} evento(s)`);
  console.log(`📱 Dispositivos notificados: ${subscriptions.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(error => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});
