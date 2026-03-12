import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

// ─── Logo URL (hosted or base64 inline) ───
const LOGO_URL = `${env.API_URL}/logo.png`;
const APP_NAME = 'AsapJoin';
const PRIMARY_COLOR = '#6366f1';
const ACCENT_COLOR = '#10b981';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  if (env.EMAIL_PROVIDER === 'smtp' && env.SMTP_URL) {
    transporter = nodemailer.createTransport(env.SMTP_URL);
    return transporter;
  }
  return null;
}

// ─── Base email layout with logo ───
function emailLayout(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <!-- Header with logo -->
        <tr><td style="text-align:center;padding:24px 0">
          <img src="${LOGO_URL}" alt="${APP_NAME}" width="140" height="auto" style="max-width:140px;height:auto" />
        </td></tr>
        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:16px;padding:40px 32px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
          <h1 style="margin:0 0 16px;font-size:22px;color:#1a1a2e;font-weight:700">${title}</h1>
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="text-align:center;padding:24px 0;color:#9ca3af;font-size:12px;line-height:1.5">
          <p style="margin:0">${APP_NAME} — Covoiturage et livraison de colis</p>
          <p style="margin:4px 0 0">© ${new Date().getFullYear()} ${APP_NAME}. Tous droits réservés.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(text: string, url: string, color = PRIMARY_COLOR): string {
  return `<a href="${url}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;font-size:14px;margin:16px 0">${text}</a>`;
}

function infoRow(label: string, value: string): string {
  return `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f5;color:#6b7280;font-size:14px;width:40%">${label}</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f5;font-size:14px;font-weight:600;color:#1a1a2e">${value}</td></tr>`;
}

function infoTable(rows: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0">${rows}</table>`;
}

// ─── Send email (multi-provider) ───
export async function sendEmail(options: EmailOptions): Promise<void> {
  const { to, subject, html, text, attachments } = options;

  if (env.EMAIL_PROVIDER === 'console') {
    logger.info(`[EMAIL] To: ${to} | Subject: ${subject}`);
    logger.debug(`[EMAIL] Body: ${text || '(html)'}`);
    return;
  }

  if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
    try {
      const body: any = { from: env.EMAIL_FROM, to: [to], subject, html, text };
      if (attachments && attachments.length > 0) {
        body.attachments = attachments.map(a => ({
          filename: a.filename,
          content: a.content.toString('base64'),
          type: a.contentType,
        }));
      }
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const respBody = await response.text();
        throw new Error(`Resend API error ${response.status}: ${respBody}`);
      }
      const result = await response.json() as { id?: string };
      logger.info(`Email sent via Resend to ${to}: ${subject} (id: ${result.id || 'unknown'})`);
    } catch (err: any) {
      logger.error(`Failed to send email via Resend to ${to}`, { error: err.message });
      if (env.isProd()) throw err;
    }
    return;
  }

  if (env.EMAIL_PROVIDER === 'smtp') {
    const transport = getTransporter();
    if (!transport) {
      logger.warn('SMTP transporter not configured, falling back to console');
      logger.info(`[EMAIL] To: ${to} | Subject: ${subject}`);
      return;
    }
    try {
      await transport.sendMail({
        from: env.EMAIL_FROM,
        to,
        subject,
        html,
        text,
        attachments: attachments?.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      logger.info(`Email sent to ${to}: ${subject}`);
    } catch (err: any) {
      logger.error(`Failed to send email to ${to}`, { error: err.message });
      throw err;
    }
    return;
  }

  if (env.EMAIL_PROVIDER === 'render' && env.RENDER_EMAIL_API_KEY) {
    try {
      const response = await fetch('https://api.render.com/email/v1/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RENDER_EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html, text }),
      });
      if (!response.ok) throw new Error(`Render Email API error: ${response.status}`);
      logger.info(`Email sent via Render to ${to}: ${subject}`);
    } catch (err: any) {
      logger.error(`Failed to send email via Render to ${to}`, { error: err.message });
      throw err;
    }
    return;
  }

  logger.warn(`No email provider configured, logging email to console`);
  logger.info(`[EMAIL] To: ${to} | Subject: ${subject}`);
}

// ═══════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════

// ─── 1. Activation de compte (Bienvenue) ───
export async function sendWelcomeEmail(to: string, data: { firstName: string }) {
  const html = emailLayout('Bienvenue sur AsapJoin ! 🎉', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.firstName}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Votre compte a été créé avec succès ! Vous pouvez maintenant réserver des trajets, envoyer des colis et bien plus encore.
    </p>
    <div style="text-align:center">
      ${btn('Découvrir AsapJoin', `${env.APP_URL}/search`)}
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
      Si vous n'avez pas créé ce compte, veuillez ignorer cet email.
    </p>
  `);

  await sendEmail({
    to,
    subject: `Bienvenue sur ${APP_NAME}, ${data.firstName} ! 🎉`,
    html,
    text: `Bienvenue sur ${APP_NAME}, ${data.firstName} ! Votre compte a été créé avec succès.`,
  });
}

// ─── 2. Reset mot de passe ───
export async function sendPasswordResetEmail(to: string, data: { firstName: string; resetUrl: string }) {
  const html = emailLayout('Réinitialisation de mot de passe 🔐', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.firstName}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau :
    </p>
    <div style="text-align:center">
      ${btn('Réinitialiser mon mot de passe', data.resetUrl)}
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
      Ce lien expire dans 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.
    </p>
  `);

  await sendEmail({
    to,
    subject: `Réinitialisation de votre mot de passe — ${APP_NAME}`,
    html,
    text: `Réinitialisez votre mot de passe : ${data.resetUrl}`,
  });
}

// ─── 3. Confirmation de réservation ───
export async function sendBookingConfirmation(to: string, data: {
  passengerName: string; tripFrom: string; tripTo: string;
  departureDate: string; seats: number; total: string;
  bookingId: string;
}) {
  const html = emailLayout('Réservation confirmée ✅', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.passengerName}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Votre réservation a été confirmée et payée avec succès !
    </p>
    ${infoTable(
      infoRow('Trajet', `${data.tripFrom} → ${data.tripTo}`) +
      infoRow('Départ', data.departureDate) +
      infoRow('Places', String(data.seats)) +
      infoRow('Total payé', `<span style="color:${PRIMARY_COLOR};font-weight:700">${data.total}</span>`)
    )}
    <div style="text-align:center">
      ${btn('Voir ma réservation', `${env.APP_URL}/booking/${data.bookingId}`)}
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
      Bon voyage avec ${APP_NAME} ! 🚗
    </p>
  `);

  await sendEmail({
    to,
    subject: `Réservation confirmée — ${data.tripFrom} → ${data.tripTo}`,
    html,
    text: `Réservation confirmée : ${data.tripFrom} → ${data.tripTo}, ${data.seats} place(s), ${data.total}`,
  });
}

// ─── 4. Paiement réussi (avec facture en PJ) ───
export async function sendPaymentReceipt(to: string, data: {
  name: string; amount: string; reference: string;
  tripFrom: string; tripTo: string; date: string;
}, invoicePdf?: Buffer) {
  const html = emailLayout('Paiement réussi 💳', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.name}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Nous avons bien reçu votre paiement. Voici le récapitulatif :
    </p>
    ${infoTable(
      infoRow('Montant', `<span style="color:${ACCENT_COLOR};font-weight:700">${data.amount}</span>`) +
      infoRow('Trajet', `${data.tripFrom} → ${data.tripTo}`) +
      infoRow('Date', data.date) +
      infoRow('Référence', `<code style="background:#f0f0f5;padding:2px 6px;border-radius:4px;font-size:12px">${data.reference}</code>`)
    )}
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center;margin:16px 0">
      <p style="margin:0;color:#166534;font-size:14px;font-weight:600">✅ Votre facture est jointe à cet email</p>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
      Merci d'utiliser ${APP_NAME} !
    </p>
  `);

  const attachments = invoicePdf ? [{
    filename: `facture-${data.reference}.pdf`,
    content: invoicePdf,
    contentType: 'application/pdf',
  }] : undefined;

  await sendEmail({
    to,
    subject: `Reçu de paiement — ${data.amount}`,
    html,
    text: `Paiement reçu : ${data.amount}. Référence : ${data.reference}`,
    attachments,
  });
}

// ─── 5. Annulation + frais ───
export async function sendCancellationEmail(to: string, data: {
  name: string; tripFrom: string; tripTo: string;
  departureDate: string; cancellationFee?: string; refundAmount?: string;
  reason?: string;
}) {
  const feeSection = data.cancellationFee ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin:16px 0">
      <p style="margin:0 0 8px;color:#991b1b;font-size:14px;font-weight:600">Frais d'annulation</p>
      <p style="margin:0;color:#dc2626;font-size:18px;font-weight:700">${data.cancellationFee}</p>
      ${data.refundAmount ? `<p style="margin:8px 0 0;color:#166534;font-size:13px">Remboursement : ${data.refundAmount}</p>` : ''}
    </div>
  ` : '';

  const html = emailLayout('Réservation annulée ❌', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.name}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Votre réservation a été annulée.
    </p>
    ${infoTable(
      infoRow('Trajet', `${data.tripFrom} → ${data.tripTo}`) +
      infoRow('Départ prévu', data.departureDate) +
      (data.reason ? infoRow('Raison', data.reason) : '')
    )}
    ${feeSection}
    <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
      Si vous avez des questions, n'hésitez pas à nous contacter.
    </p>
  `);

  await sendEmail({
    to,
    subject: `Réservation annulée — ${data.tripFrom} → ${data.tripTo}`,
    html,
    text: `Réservation annulée : ${data.tripFrom} → ${data.tripTo}. ${data.cancellationFee ? `Frais : ${data.cancellationFee}` : ''}`,
  });
}

// ─── 6. Livraison acceptée ───
export async function sendDeliveryAcceptedEmail(to: string, data: {
  senderName: string; tripFrom: string; tripTo: string;
  driverName: string; departureDate: string;
}) {
  const html = emailLayout('Livraison acceptée 📦', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.senderName}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonne nouvelle ! Le conducteur <strong>${data.driverName}</strong> a accepté votre demande de livraison.
    </p>
    ${infoTable(
      infoRow('Trajet', `${data.tripFrom} → ${data.tripTo}`) +
      infoRow('Conducteur', data.driverName) +
      infoRow('Départ', data.departureDate)
    )}
    <div style="text-align:center">
      ${btn('Voir ma livraison', `${env.APP_URL}/deliveries`, ACCENT_COLOR)}
    </div>
  `);

  await sendEmail({
    to,
    subject: `Livraison acceptée — ${data.tripFrom} → ${data.tripTo}`,
    html,
    text: `Votre livraison ${data.tripFrom} → ${data.tripTo} a été acceptée par ${data.driverName}.`,
  });
}

// ─── 7. Livraison livrée ───
export async function sendDeliveryDeliveredEmail(to: string, data: {
  recipientName: string; tripFrom: string; tripTo: string;
  deliveryCode?: string;
}) {
  const html = emailLayout('Colis livré 🎁', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.recipientName}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Votre colis a été livré ! Veuillez confirmer la réception.
    </p>
    ${infoTable(
      infoRow('Trajet', `${data.tripFrom} → ${data.tripTo}`) +
      (data.deliveryCode ? infoRow('Code de livraison', `<code style="background:#f0f0f5;padding:2px 8px;border-radius:4px;font-size:14px;font-weight:700">${data.deliveryCode}</code>`) : '')
    )}
    <div style="text-align:center">
      ${btn('Confirmer la réception', `${env.APP_URL}/deliveries`, ACCENT_COLOR)}
    </div>
  `);

  await sendEmail({
    to,
    subject: `Votre colis a été livré ! 🎁`,
    html,
    text: `Votre colis ${data.tripFrom} → ${data.tripTo} a été livré. Confirmez la réception.`,
  });
}

// ─── 8. Confirmation de réception ───
export async function sendDeliveryReceivedEmail(to: string, data: {
  senderName: string; tripFrom: string; tripTo: string;
  recipientName: string;
}) {
  const html = emailLayout('Réception confirmée ✅', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.senderName}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      <strong>${data.recipientName}</strong> a confirmé la réception de votre colis.
    </p>
    ${infoTable(
      infoRow('Trajet', `${data.tripFrom} → ${data.tripTo}`) +
      infoRow('Destinataire', data.recipientName) +
      infoRow('Statut', '<span style="color:#10b981;font-weight:700">✅ Reçu</span>')
    )}
    <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
      Merci d'utiliser ${APP_NAME} pour vos livraisons !
    </p>
  `);

  await sendEmail({
    to,
    subject: `Colis reçu — ${data.tripFrom} → ${data.tripTo}`,
    html,
    text: `${data.recipientName} a confirmé la réception de votre colis (${data.tripFrom} → ${data.tripTo}).`,
  });
}

// ─── 9. Payout conducteur ───
export async function sendPayoutEmail(to: string, data: {
  driverName: string; amount: string; payoutEmail: string;
  payoutId: string;
}) {
  const html = emailLayout('Virement effectué 💰', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.driverName}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Un virement a été initié vers votre compte. Voici les détails :
    </p>
    ${infoTable(
      infoRow('Montant', `<span style="color:${ACCENT_COLOR};font-size:18px;font-weight:700">${data.amount}</span>`) +
      infoRow('Destinataire', data.payoutEmail) +
      infoRow('Référence', data.payoutId)
    )}
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center;margin:16px 0">
      <p style="margin:0;color:#166534;font-size:14px">Le virement peut prendre 2 à 5 jours ouvrables.</p>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
      Merci de conduire avec ${APP_NAME} ! 🚗
    </p>
  `);

  await sendEmail({
    to,
    subject: `Virement de ${data.amount} initié — ${APP_NAME}`,
    html,
    text: `Virement de ${data.amount} initié vers ${data.payoutEmail}. Référence : ${data.payoutId}`,
  });
}

// ─── 10. Reçu de paiement livraison (avec facture en PJ) ───
export async function sendDeliveryPaymentReceipt(to: string, data: {
  name: string; amount: string; reference: string;
  tripFrom: string; tripTo: string; date: string;
  parcelSize: string; deliveryId: string;
}, invoicePdf?: Buffer) {
  const sizeLabels: Record<string, string> = { XS: 'Très petit', S: 'Petit', M: 'Moyen', L: 'Grand' };
  const sizeLabel = sizeLabels[data.parcelSize] || data.parcelSize;

  const html = emailLayout('Paiement de livraison réussi 📦💳', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.name}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Votre paiement pour la livraison de colis a été effectué avec succès. Voici le récapitulatif :
    </p>
    ${infoTable(
      infoRow('Montant', `<span style="color:${ACCENT_COLOR};font-weight:700">${data.amount}</span>`) +
      infoRow('Trajet', `${data.tripFrom} → ${data.tripTo}`) +
      infoRow('Taille du colis', sizeLabel) +
      infoRow('Date', data.date) +
      infoRow('Référence', `<code style="background:#f0f0f5;padding:2px 6px;border-radius:4px;font-size:12px">${data.reference}</code>`)
    )}
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center;margin:16px 0">
      <p style="margin:0;color:#166534;font-size:14px;font-weight:600">✅ Votre reçu est joint à cet email</p>
    </div>
    <div style="text-align:center">
      ${btn('Voir ma livraison', `${env.APP_URL}/deliveries`, ACCENT_COLOR)}
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
      Merci d'utiliser ${APP_NAME} pour vos livraisons ! 📦
    </p>
  `);

  const attachments = invoicePdf ? [{
    filename: `recu-livraison-${data.reference}.pdf`,
    content: invoicePdf,
    contentType: 'application/pdf',
  }] : undefined;

  await sendEmail({
    to,
    subject: `Reçu de paiement livraison — ${data.amount}`,
    html,
    text: `Paiement livraison reçu : ${data.amount}. Trajet : ${data.tripFrom} → ${data.tripTo}. Référence : ${data.reference}`,
    attachments,
  });
}

// ─── 11. Rappel de trajet (existant, amélioré) ───
export async function sendTripReminder(to: string, data: { name: string; tripFrom: string; tripTo: string; departureDate: string }) {
  const html = emailLayout('Rappel de trajet ⏰', `
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Bonjour <strong>${data.name}</strong>,
    </p>
    <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 16px">
      Votre trajet approche ! N'oubliez pas de vous préparer.
    </p>
    ${infoTable(
      infoRow('Trajet', `${data.tripFrom} → ${data.tripTo}`) +
      infoRow('Départ', data.departureDate)
    )}
    <div style="text-align:center">
      ${btn('Voir le trajet', `${env.APP_URL}/search`)}
    </div>
  `);

  await sendEmail({
    to,
    subject: `Rappel : ${data.tripFrom} → ${data.tripTo} — ${data.departureDate}`,
    html,
    text: `Rappel : trajet ${data.tripFrom} → ${data.tripTo} le ${data.departureDate}`,
  });
}
