const webpush = require('web-push');
const https = require('https');

const VAPID_PUBLIC_KEY = 'BNrCEJzq3O8KEEELwyOeRiHQU3911ptH6DYQ_2JuqYXim68Hw12IUfd8Z9dfz9kCEgyNKrNzPLrm0hzrz9UORKI';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PRIVATE_KEY) {
  console.error('❌ VAPID_PRIVATE_KEY no configurada');
  console.error('   Configúrala en: Settings → Secrets and variables → Actions');
  process.exit(1);
}

webpush.setVapidDetails(
  'mailto:admin@orientefraterno148.app',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const PROJECT_ID = 'orientefraterno148-2a0c1';
const API_KEY = 'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

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
          reject(new Error(`Error parseando JSON: ${e.message}`));
        }
      });
    }).on('error', (e) => {
      reject(new Error(`Error de red: ${e.message}`));
    });
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

function getTodayDate() {
  const now = new Date();
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

async function sendNotification(subscription, title, body, tag) {
  try {
    const payload = JSON.stringify({ 
      title, 
      body, 
      url: 'https://caristim.github.io/oriente-fraterno/',
      tag 
    });
    
    await webpush.sendNotification(subscription, payload, { 
      TTL: 86400, 
      urgency: 'high' 
    });
    
    console.log(`  ✅ Enviado correctamente`);
    return { success: true };
  } catch (error) {
    const isInvalid = error.statusCode === 404 || error.statusCode === 410;
    console.log(`  ❌ Falló (${error.statusCode || 'unknown'}): ${isInvalid ? 'suscripción inválida' : error.message}`);
    return { success: false, invalid: isInvalid };
  }
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔔 Oriente Fraterno 148 - Notificador Diario');
  console.log(`📅 Fecha hoy: ${getTodayDate()}`);
  console.log(`📅 Fecha mañana: ${getTomorrowDate()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Obtener eventos
  console.log('\n📖 Leyendo eventos de Firestore...');
  let eventos = [];
  try {
    const docs = await firestoreGet('eventos');
    eventos = docs.map(parseFirestoreDoc);
    console.log(`📊 Total eventos en Firestore: ${eventos.length}`);
  } catch (error) {
    console.error('❌ Error leyendo eventos:', error.message);
    process.exit(1);
  }

  const hoy = eventos.filter(e => e.fecha === getTodayDate());
  const manana = eventos.filter(e => e.fecha === getTomorrowDate());

  console.log(`📅 Eventos hoy: ${hoy.length}`);
  console.log(`📅 Eventos mañana: ${manana.length}`);

  if (hoy.length === 0 && manana.length === 0) {
    console.log('\n✨ No hay eventos para hoy o mañana. Fin.');
    return;
  }

  // 2. Obtener suscripciones
  console.log('\n📖 Leyendo suscripciones Web Push...');
  let subs = [];
  try {
    const docs = await firestoreGet('webpush_subscriptions');
    subs = docs.map(parseFirestoreDoc).filter(s => s.endpoint && s.p256dh && s.auth);
    console.log(`📱 Dispositivos registrados: ${subs.length}`);
  } catch (error) {
    console.error('❌ Error leyendo suscripciones:', error.message);
    process.exit(1);
  }

  if (subs.length === 0) {
    console.log('\n⚠️ No hay dispositivos registrados para notificar.');
    console.log('💡 Los usuarios deben abrir la app y activar notificaciones.');
    return;
  }

  // 3. Enviar notificaciones
  console.log('\n📨 Enviando notificaciones...');

  const todosLosEventos = [...hoy, ...manana];
  let enviados = 0;
  let fallidos = 0;

  for (const ev of todosLosEventos) {
    const cuando = hoy.includes(ev) ? 'Hoy' : 'Mañana';
    const emoji = getEmojiForTipo(ev.tipo);
    const title = 'Oriente Fraterno · 148';
    const body = `${emoji} ${cuando}: ${ev.tipo} de ${ev.nombre}`;
    const tag = `evento-${ev.id || Date.now()}`;

    console.log(`\n📌 ${body}`);

    for (const sub of subs) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      const result = await sendNotification(pushSub, title, body, tag);
      if (result.success) {
        enviados++;
      } else {
        fallidos++;
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Proceso completado.');
  console.log(`   ✅ Enviados: ${enviados}`);
  console.log(`   ❌ Fallidos: ${fallidos}`);
  console.log(`   📱 Dispositivos: ${subs.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(error => {
  console.error('\n❌ Error fatal:', error.message);
  console.error(error.stack);
  process.exit(1);
});
