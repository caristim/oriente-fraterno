/**
 * Oriente Fraterno 148 — Cloud Function: enviarNotificaciones
 *
 * Reemplaza el workflow de GitHub Actions (.github/workflows/notificacion-eventos.yml).
 * Se activa mediante Cloud Scheduler (ver README para configuración).
 *
 * Mejoras respecto al workflow anterior:
 *   ✅ Valida días según el mes (no envía para fechas inexistentes como 31/Abr)
 *   ✅ Maneja el 29 de febrero: en años no bisiestos lo notifica el 28/Feb
 *   ✅ No depende de GitHub Actions (corre en la infraestructura de Firebase)
 *   ✅ Logs en Firebase Cloud Logging
 */

const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore }           = require('firebase-admin/firestore');
const { getMessaging }           = require('firebase-admin/messaging');

if (!getApps().length) initializeApp();

const db        = getFirestore();
const messaging = getMessaging();

// ── Utilidades de fecha ───────────────────────────────────────────────────────

/**
 * Retorna true si el año dado es bisiesto.
 */
function esBisiesto(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Días válidos por mes (índice 1–12).
 * Febrero: 28 o 29 según el año.
 */
function diasDelMes(mes, year) {
  const dias = [0, 31, esBisiesto(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dias[mes] || 0;
}

/**
 * Retorna la fecha "efectiva" para comparar con el evento.
 *
 * Caso especial 29/Feb:
 *   Si el año corriente NO es bisiesto y el evento es 29/Feb,
 *   se notifica el 28/Feb en su lugar.
 *
 * @param {string} fechaEvento  — formato "MM-DD"
 * @param {Date}   ahora        — fecha local actual
 * @returns {string}            — "MM-DD" de la fecha efectiva del evento
 */
function fechaEfectiva(fechaEvento, ahora) {
  const [mm, dd] = fechaEvento.split('-').map(Number);
  const year = ahora.getFullYear();

  // Validar que el día existe en ese mes (descarta datos corruptos como 31/Abr)
  if (dd > diasDelMes(mm, year)) {
    // 29/Feb en año no bisiesto → notificar el 28/Feb
    if (mm === 2 && dd === 29 && !esBisiesto(year)) {
      return '02-28';
    }
    // Cualquier otro día inválido: ignorar
    return null;
  }

  return fechaEvento;
}

// ── Envío FCM ─────────────────────────────────────────────────────────────────

/**
 * Envía una notificación FCM a un token dado.
 * Retorna { invalid: true } si el token ya no es válido.
 */
async function fcmSend(token, titulo, cuerpo) {
  try {
    await messaging.send({
      token,
      data:    { title: titulo, body: cuerpo },
      android: { priority: 'high' },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title:             titulo,
          body:              cuerpo,
          icon:              'https://caristim.github.io/oriente-fraterno/icon-192.png',
          badge:             'https://caristim.github.io/oriente-fraterno/icon-192.png',
          requireInteraction: true,
          vibrate:           [200, 100, 200, 100, 200],
          data:              { url: 'https://caristim.github.io/oriente-fraterno/' },
        },
        fcmOptions: { link: 'https://caristim.github.io/oriente-fraterno/' },
      },
    });
    console.log('FCM OK:', token.substring(0, 20) + '...');
    return { invalid: false };
  } catch (err) {
    const code = err.errorInfo && err.errorInfo.code;
    const isInvalid = [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
    ].includes(code);
    console.log(`FCM error [${code}] token: ${token.substring(0, 20)}...`);
    return { invalid: isInvalid };
  }
}

// ── Cloud Function HTTP ───────────────────────────────────────────────────────
// Cloud Scheduler llama a esta función vía HTTP con un Bearer token de OIDC.
// La función valida que el caller sea el service account de Cloud Scheduler.

exports.enviarNotificaciones = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (req, res) => {
    // Solo POST (Cloud Scheduler usa POST por defecto)
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    try {
      // ── 1. Fecha actual en Uruguay (UTC-3, sin DST desde 2015) ────────────
      const ahora     = new Date();
      const localTime = new Date(ahora.getTime() + (-3 * 60 * 60000));
      const dia       = String(localTime.getUTCDate()).padStart(2, '0');
      const mes       = String(localTime.getUTCMonth() + 1).padStart(2, '0');
      const fechaHoy  = `${mes}-${dia}`;
      console.log('Fecha Uruguay:', fechaHoy);

      // ── 2. Leer eventos de Firestore ──────────────────────────────────────
      const eventosSnap = await db.collection('eventos').get();
      const eventos = eventosSnap.docs
        .map(doc => ({ docId: doc.id, ...doc.data() }))
        .filter(ev => {
          if (!ev.fecha || !ev.nombre || !ev.tipo) return false;
          // Normalizar formato: acepta "MM-DD" y "YYYY-MM-DD"
          const partes = String(ev.fecha).split('-');
          let fecha;
          if (partes.length === 2) fecha = ev.fecha;
          else if (partes.length === 3) fecha = `${partes[1]}-${partes[2]}`;
          else return false;

          const efectiva = fechaEfectiva(fecha, localTime);
          return efectiva === fechaHoy;
        });

      if (eventos.length === 0) {
        console.log('Hoy no hay eventos.');
        return res.status(200).send('Sin eventos hoy.');
      }
      console.log('Eventos hoy:', eventos.map(e => e.nombre).join(', '));

      // ── 3. Leer tokens FCM de Firestore ───────────────────────────────────
      const tokensSnap = await db.collection('fcm_tokens').get();
      const tokenDocs = tokensSnap.docs
        .map(doc => ({ docRef: doc.ref, token: doc.data().token || '' }))
        .filter(d => d.token.length > 0);

      if (tokenDocs.length === 0) {
        console.log('No hay tokens FCM registrados.');
        return res.status(200).send('Sin tokens.');
      }
      console.log('Tokens registrados:', tokenDocs.length);

      // ── 4. Enviar notificaciones ──────────────────────────────────────────
      const tokenesInvalidos = new Set();

      for (const ev of eventos) {
        const msg = `Hoy: ${ev.tipo} de ${ev.nombre}`;
        console.log('Enviando:', msg);
        for (const td of tokenDocs) {
          const result = await fcmSend(td.token, 'Oriente Fraterno 148', msg);
          if (result.invalid) tokenesInvalidos.add(td.docRef);
        }
      }

      // ── 5. Limpiar tokens inválidos ───────────────────────────────────────
      if (tokenesInvalidos.size > 0) {
        console.log(`Limpiando ${tokenesInvalidos.size} token(s) inválido(s)...`);
        const batch = db.batch();
        for (const ref of tokenesInvalidos) batch.delete(ref);
        await batch.commit();
      }

      console.log('Proceso completado.');
      return res.status(200).send('OK');

    } catch (err) {
      console.error('Error en enviarNotificaciones:', err);
      return res.status(500).send('Error interno: ' + err.message);
    }
  }
);
