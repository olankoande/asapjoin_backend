import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { env } from '../../config/env';

const LOGO_PATH = path.resolve(__dirname, '../../../logo_asap_1024.png');
const APP_NAME = 'AsapJoin';
const PRIMARY_COLOR = '#6366f1';

interface InvoiceData {
  invoiceNumber: string;
  date: string;
  customerName: string;
  customerEmail: string;
  tripFrom: string;
  tripTo: string;
  departureDate: string;
  seats: number;
  pricePerSeat: number;
  totalAmount: number;
  currency: string;
  paymentMethod: string;
  stripePaymentIntentId?: string;
  /** Platform service fee in dollars (optional, shown as separate line) */
  serviceFee?: number;
  /** Driver base price in dollars (optional, = seats * pricePerSeat) */
  driverPrice?: number;
}

function formatCurrency(amount: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(amount);
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 100; // margins

      // ─── Logo ───
      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, 50, 40, { width: 80 });
      }

      // ─── Company info (right side) ───
      doc.fontSize(10).fillColor('#6b7280')
        .text(APP_NAME, 350, 45, { align: 'right' })
        .text('Covoiturage et livraison de colis', 350, 60, { align: 'right' })
        .text(env.APP_URL, 350, 75, { align: 'right' });

      // ─── FACTURE title ───
      doc.moveDown(3);
      const titleY = 120;
      doc.fontSize(28).fillColor(PRIMARY_COLOR).font('Helvetica-Bold')
        .text('FACTURE', 50, titleY);

      // ─── Invoice info ───
      const infoY = titleY + 45;
      doc.fontSize(10).fillColor('#374151').font('Helvetica');
      doc.text(`N° Facture : ${data.invoiceNumber}`, 50, infoY);
      doc.text(`Date : ${data.date}`, 50, infoY + 16);

      // ─── Customer info ───
      const custY = infoY + 50;
      doc.fontSize(11).fillColor(PRIMARY_COLOR).font('Helvetica-Bold')
        .text('Facturé à :', 50, custY);
      doc.fontSize(10).fillColor('#374151').font('Helvetica')
        .text(data.customerName, 50, custY + 18)
        .text(data.customerEmail, 50, custY + 34);

      // ─── Table header ───
      const tableY = custY + 70;
      const colX = { desc: 50, qty: 320, price: 400, total: 480 };

      // Header background
      doc.rect(50, tableY, pageWidth, 28).fill('#f3f4f6');
      doc.fontSize(9).fillColor('#374151').font('Helvetica-Bold');
      doc.text('Description', colX.desc + 8, tableY + 8);
      doc.text('Qté', colX.qty, tableY + 8);
      doc.text('Prix unit.', colX.price, tableY + 8);
      doc.text('Total', colX.total, tableY + 8);

      // ─── Table row: Trip ───
      const rowY = tableY + 32;
      const driverSubtotal = data.driverPrice ?? (data.pricePerSeat * data.seats);
      doc.fontSize(9).fillColor('#1f2937').font('Helvetica');
      doc.text(`Trajet : ${data.tripFrom} → ${data.tripTo}`, colX.desc + 8, rowY);
      doc.text(`Départ : ${data.departureDate}`, colX.desc + 8, rowY + 14, { width: 260 });
      doc.text(String(data.seats), colX.qty, rowY);
      doc.text(formatCurrency(data.pricePerSeat, data.currency), colX.price, rowY);
      doc.text(formatCurrency(driverSubtotal, data.currency), colX.total, rowY);

      // Line under trip row
      let nextRowY = rowY + 32;

      // ─── Service fee row (if applicable) ───
      if (data.serviceFee && data.serviceFee > 0) {
        doc.moveTo(50, nextRowY).lineTo(50 + pageWidth, nextRowY).strokeColor('#e5e7eb').stroke();
        nextRowY += 6;
        doc.fontSize(9).fillColor('#6b7280').font('Helvetica');
        doc.text('Frais de service AsapJoin', colX.desc + 8, nextRowY);
        doc.text('1', colX.qty, nextRowY);
        doc.text(formatCurrency(data.serviceFee, data.currency), colX.price, nextRowY);
        doc.text(formatCurrency(data.serviceFee, data.currency), colX.total, nextRowY);
        nextRowY += 20;
      }

      // Line under last row
      doc.moveTo(50, nextRowY).lineTo(50 + pageWidth, nextRowY).strokeColor('#e5e7eb').stroke();

      // ─── Subtotal / Total ───
      const totalY = nextRowY + 18;
      doc.fontSize(10).fillColor('#6b7280').font('Helvetica')
        .text('Sous-total :', 380, totalY)
        .text(formatCurrency(driverSubtotal, data.currency), colX.total, totalY);

      let summaryOffset = 18;
      if (data.serviceFee && data.serviceFee > 0) {
        doc.text('Frais de service :', 380, totalY + summaryOffset)
          .text(formatCurrency(data.serviceFee, data.currency), colX.total, totalY + summaryOffset);
        summaryOffset += 18;
      }

      doc.text('Taxes (incluses) :', 380, totalY + summaryOffset)
        .text('0,00 $', colX.total, totalY + summaryOffset);
      summaryOffset += 18;

      // Total box
      const totalBoxY = totalY + summaryOffset + 8;
      doc.rect(370, totalBoxY, pageWidth - 320, 32).fill(PRIMARY_COLOR);
      doc.fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
        .text('TOTAL', 385, totalBoxY + 9)
        .text(formatCurrency(data.totalAmount, data.currency), colX.total - 10, totalBoxY + 9);

      // ─── Payment info ───
      const payInfoY = totalBoxY + 55;
      doc.fontSize(9).fillColor('#6b7280').font('Helvetica')
        .text(`Méthode de paiement : ${data.paymentMethod}`, 50, payInfoY);
      if (data.stripePaymentIntentId) {
        doc.text(`Référence Stripe : ${data.stripePaymentIntentId}`, 50, payInfoY + 14);
      }
      doc.text(`Statut : Payé ✓`, 50, payInfoY + 28);

      // ─── Footer ───
      const footerY = doc.page.height - 80;
      doc.moveTo(50, footerY).lineTo(50 + pageWidth, footerY).strokeColor('#e5e7eb').stroke();
      doc.fontSize(8).fillColor('#9ca3af').font('Helvetica')
        .text(`${APP_NAME} — Covoiturage et livraison de colis`, 50, footerY + 10, { align: 'center', width: pageWidth })
        .text(`© ${new Date().getFullYear()} ${APP_NAME}. Tous droits réservés.`, 50, footerY + 22, { align: 'center', width: pageWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// DELIVERY INVOICE
// ═══════════════════════════════════════════════════════════

interface DeliveryInvoiceData {
  invoiceNumber: string;
  date: string;
  customerName: string;
  customerEmail: string;
  tripFrom: string;
  tripTo: string;
  departureDate: string;
  parcelSize: string;
  parcelWeight?: number | null;
  totalAmount: number;
  currency: string;
  paymentMethod: string;
  stripePaymentIntentId?: string;
}

export async function generateDeliveryInvoicePdf(data: DeliveryInvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 100;

      // ─── Logo ───
      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, 50, 40, { width: 80 });
      }

      // ─── Company info (right side) ───
      doc.fontSize(10).fillColor('#6b7280')
        .text(APP_NAME, 350, 45, { align: 'right' })
        .text('Covoiturage et livraison de colis', 350, 60, { align: 'right' })
        .text(env.APP_URL, 350, 75, { align: 'right' });

      // ─── REÇU title ───
      doc.moveDown(3);
      const titleY = 120;
      doc.fontSize(28).fillColor(PRIMARY_COLOR).font('Helvetica-Bold')
        .text('REÇU DE LIVRAISON', 50, titleY);

      // ─── Invoice info ───
      const infoY = titleY + 45;
      doc.fontSize(10).fillColor('#374151').font('Helvetica');
      doc.text(`N° Reçu : ${data.invoiceNumber}`, 50, infoY);
      doc.text(`Date : ${data.date}`, 50, infoY + 16);

      // ─── Customer info ───
      const custY = infoY + 50;
      doc.fontSize(11).fillColor(PRIMARY_COLOR).font('Helvetica-Bold')
        .text('Expéditeur :', 50, custY);
      doc.fontSize(10).fillColor('#374151').font('Helvetica')
        .text(data.customerName, 50, custY + 18)
        .text(data.customerEmail, 50, custY + 34);

      // ─── Table header ───
      const tableY = custY + 70;
      const colX = { desc: 50, details: 320, total: 460 };

      // Header background
      doc.rect(50, tableY, pageWidth, 28).fill('#f3f4f6');
      doc.fontSize(9).fillColor('#374151').font('Helvetica-Bold');
      doc.text('Description', colX.desc + 8, tableY + 8);
      doc.text('Détails', colX.details, tableY + 8);
      doc.text('Total', colX.total, tableY + 8);

      // ─── Table row ───
      const rowY = tableY + 32;
      doc.fontSize(9).fillColor('#1f2937').font('Helvetica');
      doc.text(`Livraison de colis`, colX.desc + 8, rowY);
      doc.text(`${data.tripFrom} → ${data.tripTo}`, colX.desc + 8, rowY + 14, { width: 260 });
      doc.text(`Départ : ${data.departureDate}`, colX.desc + 8, rowY + 28, { width: 260 });

      const sizeLabels: Record<string, string> = { XS: 'Très petit', S: 'Petit', M: 'Moyen', L: 'Grand' };
      const sizeLabel = sizeLabels[data.parcelSize] || data.parcelSize;
      doc.text(`Taille : ${sizeLabel}`, colX.details, rowY);
      if (data.parcelWeight) {
        doc.text(`Poids : ${data.parcelWeight} kg`, colX.details, rowY + 14);
      }
      doc.text(formatCurrency(data.totalAmount, data.currency), colX.total, rowY);

      // Line under row
      doc.moveTo(50, rowY + 46).lineTo(50 + pageWidth, rowY + 46).strokeColor('#e5e7eb').stroke();

      // ─── Total ───
      const totalY = rowY + 60;
      doc.fontSize(10).fillColor('#6b7280').font('Helvetica')
        .text('Sous-total :', 380, totalY)
        .text(formatCurrency(data.totalAmount, data.currency), colX.total, totalY);

      doc.text('Taxes (incluses) :', 380, totalY + 18)
        .text('0,00 $', colX.total, totalY + 18);

      // Total box
      const totalBoxY = totalY + 44;
      doc.rect(370, totalBoxY, pageWidth - 320, 32).fill(PRIMARY_COLOR);
      doc.fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
        .text('TOTAL', 385, totalBoxY + 9)
        .text(formatCurrency(data.totalAmount, data.currency), colX.total - 10, totalBoxY + 9);

      // ─── Payment info ───
      const payInfoY = totalBoxY + 55;
      doc.fontSize(9).fillColor('#6b7280').font('Helvetica')
        .text(`Méthode de paiement : ${data.paymentMethod}`, 50, payInfoY);
      if (data.stripePaymentIntentId) {
        doc.text(`Référence Stripe : ${data.stripePaymentIntentId}`, 50, payInfoY + 14);
      }
      doc.text(`Statut : Payé ✓`, 50, payInfoY + 28);

      // ─── Footer ───
      const footerY = doc.page.height - 80;
      doc.moveTo(50, footerY).lineTo(50 + pageWidth, footerY).strokeColor('#e5e7eb').stroke();
      doc.fontSize(8).fillColor('#9ca3af').font('Helvetica')
        .text(`${APP_NAME} — Covoiturage et livraison de colis`, 50, footerY + 10, { align: 'center', width: pageWidth })
        .text(`© ${new Date().getFullYear()} ${APP_NAME}. Tous droits réservés.`, 50, footerY + 22, { align: 'center', width: pageWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
