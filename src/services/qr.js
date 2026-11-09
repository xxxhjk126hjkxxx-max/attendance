'use strict';

const path = require('node:path');
const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { hasArabic, toVisual } = require('../lib/arabic');
const { translator } = require('../lib/i18n');
const { notFound, unprocessable } = require('../lib/errors');

const FONT_DIR = path.resolve(__dirname, '../../public/assets/fonts');

/**
 * Server-side QR rendering and student card composition.
 *
 * Card downloads and bulk sheets are generated on the server so that printed
 * cards are identical everywhere and Arabic text is shaped correctly.
 */
function createQrService(db, { students, university }) {
  async function payloadFor(studentId) {
    const card = students.qrCard(studentId);
    return card.item;
  }

  async function qrPng(data, { width = 480, margin = 2 } = {}) {
    return QRCode.toBuffer(JSON.stringify(data), {
      type: 'png',
      width,
      margin,
      errorCorrectionLevel: 'M',
      color: { dark: '#142B45', light: '#ffffff' }
    });
  }

  async function qrSvg(data) {
    return QRCode.toString(JSON.stringify(data), {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#142B45', light: '#ffffff' }
    });
  }

  /** Decodes a QR code from an uploaded image using the pure-JS jsQR decoder. */
  function decodeImage(buffer) {
    const png = decodePng(buffer);
    if (!png) throw unprocessable('Upload a PNG image of the QR code (JPEG and WebP are also accepted after conversion).');
    const result = jsQR(png.data, png.width, png.height, { inversionAttempts: 'attemptBoth' });
    if (!result || !result.data) return null;
    return result.data;
  }

  /**
   * Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced), which covers phone
   * screenshots and canvas exports without adding a native image dependency.
   */
  function decodePng(buffer) {
    const zlib = require('node:zlib');
    if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idat = [];
    while (offset < buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      const data = buffer.subarray(offset + 8, offset + 8 + length);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
        interlace = data[12];
      } else if (type === 'IDAT') {
        idat.push(data);
      } else if (type === 'IEND') {
        break;
      }
      offset += length + 12;
    }
    if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
    if (!channels) return null;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels = new Uint8ClampedArray(width * height * 4);
    let previous = Buffer.alloc(stride);
    let pos = 0;
    for (let y = 0; y < height; y += 1) {
      const filter = raw[pos];
      pos += 1;
      const line = Buffer.from(raw.subarray(pos, pos + stride));
      pos += stride;
      for (let x = 0; x < stride; x += 1) {
        const left = x >= channels ? line[x - channels] : 0;
        const up = previous[x];
        const upLeft = x >= channels ? previous[x - channels] : 0;
        let value = line[x];
        if (filter === 1) value += left;
        else if (filter === 2) value += up;
        else if (filter === 3) value += Math.floor((left + up) / 2);
        else if (filter === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value += (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
        }
        line[x] = value & 0xff;
      }
      for (let x = 0; x < width; x += 1) {
        const i = x * channels;
        const o = (y * width + x) * 4;
        if (channels === 1) {
          pixels[o] = pixels[o + 1] = pixels[o + 2] = line[i];
          pixels[o + 3] = 255;
        } else {
          pixels[o] = line[i];
          pixels[o + 1] = line[i + 1];
          pixels[o + 2] = line[i + 2];
          pixels[o + 3] = channels === 4 ? line[i + 3] : 255;
        }
      }
      previous = line;
    }
    return { data: pixels, width, height };
  }

  /** Draws a single A6-ish student card (595x300pt) as a PDF buffer. */
  async function cardPdf(studentIds, { lang = 'en' } = {}) {
    const PDFDocument = require('pdfkit');
    const ids = (Array.isArray(studentIds) ? studentIds : [studentIds]).slice(0, 200);
    if (!ids.length) throw unprocessable('Select at least one student.');
    const t = translator(lang);
    const rtl = lang === 'ar';

    const doc = new PDFDocument({ size: [595, 300], margin: 0, autoFirstPage: false, info: { Title: 'Student Attendance Cards' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

    for (const id of ids) {
      const student = await payloadFor(id).catch(() => null);
      if (!student) continue;
      doc.addPage({ size: [595, 300], margin: 0 });
      await drawCard(doc, student, { t, rtl });
    }
    if (doc.bufferedPageRange().count === 0) throw notFound('None of the selected students could be found.');
    doc.end();
    return done;
  }

  async function drawCard(doc, student, { t, rtl }) {
    const W = 595;
    const H = 300;
    const navy = '#142B45';
    const gold = '#C5A15B';
    const ink = '#263445';
    const muted = '#718092';

    doc.rect(0, 0, W, H).fill('#ffffff');
    doc.rect(0, 0, W, 84).fill(navy);
    doc.rect(0, 84, W, 4).fill(gold);

    const text = value => (rtl ? toVisual(String(value ?? '')) : String(value ?? ''));
    doc.registerFont('Cairo', path.join(FONT_DIR, 'Cairo-SemiBold.ttf'));
    doc.registerFont('CairoBold', path.join(FONT_DIR, 'Cairo-Bold.ttf'));

    doc.fillColor('#ffffff').font('CairoBold').fontSize(15);
    doc.text(text(rtl ? university.nameAr : university.nameEn), rtl ? 520 : 28, 24, { width: rtl ? 0 : 380, align: rtl ? 'right' : 'left' });
    doc.font('Cairo').fontSize(9).fillColor('#C9D6E2');
    doc.text(text(rtl ? 'إدارة الشؤون الأكاديمية' : 'Office of Academic Affairs'), rtl ? 520 : 28, 50, { width: rtl ? 0 : 380, align: rtl ? 'right' : 'left' });

    // QR area
    const qrSize = 140;
    const qrX = rtl ? 28 : W - qrSize - 28;
    const qrY = 108;
    if (student.qr) {
      const png = await QRCode.toBuffer(JSON.stringify(student.qr), { type: 'png', width: qrSize * 3, margin: 1 });
      doc.image(png, qrX, qrY, { width: qrSize, height: qrSize });
      doc.rect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8).lineWidth(1).strokeColor('#E4E9EF').stroke();
    } else {
      doc.rect(qrX, qrY, qrSize, qrSize).fill('#F3F5F8');
      doc.fillColor('#B84545').font('Cairo').fontSize(10)
        .text(text(t('qr.revoked')), qrX + 6, qrY + qrSize / 2 - 6, { width: qrSize - 12, align: 'center' });
    }

    const textX = rtl ? 190 : 28;
    const textWidth = 380;
    const align = rtl ? 'right' : 'left';
    doc.fillColor(muted).font('Cairo').fontSize(9)
      .text(text(t('qr.card')), textX, 104, { width: textWidth, align });
    doc.fillColor(ink).font('CairoBold').fontSize(20)
      .text(text(student.name), textX, 120, { width: textWidth, align });
    doc.fillColor(muted).font('Cairo').fontSize(9)
      .text(text(`${t('studentId')}: ${student.id}`), textX, 150, { width: textWidth, align });
    if (student.course) {
      doc.text(text(`${t('course')}: ${student.course}`), textX, 168, { width: textWidth, align });
    }
    if (student.level) {
      doc.text(text(`${t('level')}: ${student.level}`), textX, 186, { width: textWidth, align });
    }
    if (student.qr) {
      const token = String(student.qr.token);
      doc.fillColor(muted).font('Cairo').fontSize(7)
        .text(text(`${t('qr.token')}: ${token.slice(0, 18)}…`), textX, 206, { width: textWidth, align });
    }

    doc.rect(28, 236, W - 56, 1).fill('#E4E9EF');
    doc.fillColor(muted).font('Cairo').fontSize(9)
      .text(text(t('qr.scan')), textX, 248, { width: textWidth, align });
    doc.fillColor(gold).font('CairoBold').fontSize(9)
      .text('UNIVERSITY ATTENDANCE', rtl ? 28 : W - 200, 248, { width: 172, align: rtl ? 'left' : 'right' });
  }

  async function bulkQrPngs(filters, { columns = 3 } = {}) {
    const cards = students.qrCards(filters).items.filter(card => card.qr);
    return {
      count: cards.length,
      images: await Promise.all(cards.slice(0, 60).map(async card => ({
        id: card.id,
        name: card.name,
        dataUrl: `data:image/png;base64,${(await qrPng(card.qr, { width: 320, margin: 1 })).toString('base64')}`
      }))),
      columns
    };
  }

  return { payloadFor, qrPng, qrSvg, decodeImage, cardPdf, bulkQrPngs, drawCard };
}

module.exports = { createQrService };
