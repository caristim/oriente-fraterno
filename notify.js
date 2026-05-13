// notify.js — corre en GitHub Actions a las 9:00 AM (hora Uruguay)
// Lee los eventos de Firestore y manda push FCM a todos los dispositivos registrados.

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore }        = require('firebase-admin/firestore');
const { getMessaging }        = require('firebase-admin/messaging');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({ credential: cert(serviceAccount) });

const db        = getFirestore();
const messaging = getMessaging();

async function main() {
  // Fecha de hoy en Uruguay
  const ahora     = new Date();
  const enUruguay = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Montevideo' }));
  const mes = String(enUruguay.getMonth() + 1).padStart(2, '0');
  const dia = String(enUruguay.getDate()).padStart(2, '0');

  console.log(`Verificando eventos para: ${dia}/${mes}`);

  // 1. Buscar eventos de hoy
  const snap       = await db.collection('eventos').get();
  const eventosHoy = [];

  snap.forEach(doc => {
    const ev = doc.data();
    if (!ev.fecha || !ev.nombre || !ev.tipo) return;
    const parts = String(ev.fecha).split('-');
    let evMes, evDia;
    if (parts.length === 2)      [evMes, evDia] = parts;
    else if (parts.length === 3) [, evMes, evDia] = parts;
    else return;
    if (evMes === mes && evDia === dia) eventosHoy.push(ev);
  });

  if (eventosHoy.length === 0) {
    console.log('Sin eventos para hoy. No se envían notificaciones.');
    return;
  }

  console.log(`Eventos de hoy: ${eventosHoy.length}`);

  // 2. Obtener tokens FCM de todos los dispositivos
  const tokensSnap = await db.collection('fcm_tokens').get();
  const tokens     = tokensSnap.docs.map(d => d.data().token).filter(Boolean);

  if (tokens.length === 0) {
    console.log('Sin dispositivos registrados.');
    return;
  }

  console.log(`Enviando a ${tokens.length} dispositivo(s)`);

  // 3. Armar el mensaje
  const title = eventosHoy.length === 1
    ? 'Oriente Fraterno ✦'
    : `Oriente Fraterno ✦ · ${eventosHoy.length} eventos hoy`;
  const body = eventosHoy.map(ev => `${ev.tipo} de ${ev.nombre}`).join(' · ');

  // 4. Enviar en lotes de 500 con prioridad alta para entrega inmediata
  const BATCH = 500;
  for (let i = 0; i < tokens.length; i += BATCH) {
    const lote      = tokens.slice(i, i + BATCH);
    const resultado = await messaging.sendEachForMulticast({
      tokens: lote,
      notification: { title, body },
      android: {
        priority: 'high',         // prioridad alta en Android, evita retrasos del sistema
      },
      webpush: {
        headers: {
          Urgency: 'high',        // entrega inmediata en navegadores
        },
        notification: {
          title, body,
          icon:               '/icon-192.png',
          badge:              '/icon-192.png',
          requireInteraction: true,
          vibrate:            [200, 100, 200, 100, 200],
        },
        fcmOptions: { link: '/' },
      },
    });

    console.log(`OK: ${resultado.successCount} · Errores: ${resultado.failureCount}`);

    // Limpiar tokens inválidos de Firestore
    const invalidos = resultado.responses
      .map((res, idx) => (!res.success &&
        (res.error?.code === 'messaging/invalid-registration-token' ||
         res.error?.code === 'messaging/registration-token-not-registered'))
        ? lote[idx] : null)
      .filter(Boolean);

    if (invalidos.length > 0) {
      const batch = db.batch();
      invalidos.forEach(t => batch.delete(db.collection('fcm_tokens').doc(t)));
      await batch.commit();
      console.log(`${invalidos.length} token(s) inválido(s) eliminado(s)`);
    }
  }

  console.log('Listo.');
}

main().catch(err => { console.error(err); process.exit(1); });
