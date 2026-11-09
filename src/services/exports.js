'use strict';

const path = require('node:path');
const ExcelJS = require('exceljs');
const { translator } = require('../lib/i18n');
const { preparePdfText, hasArabic } = require('../lib/arabic');

const FONT_DIR = path.resolve(__dirname, '../../public/assets/fonts');
const NAVY = 'FF142B45';
const GOLD = 'FFC5A15B';
const LIGHT = 'FFF5F7FA';

function createExportService({ university }) {
  const COLUMNS = {
    studentId: { width: 18 },
    studentName: { width: 28 },
    course: { width: 26 },
    lecture: { width: 30 },
    date: { width: 14 },
    time: { width: 10 },
    status: { width: 12 },
    source: { width: 14 },
    markedBy: { width: 18 },
    markedAt: { width: 20 },
    level: { width: 16 },
    notes: { width: 28 },
    present: { width: 10 },
    late: { width: 10 },
    excused: { width: 12 },
    absent: { width: 10 },
    rate: { width: 14 },
    marked: { width: 12 }
  };

  /**
   * Builds a real XLSX workbook (Office Open XML) — not a renamed CSV.
   */
  async function attendanceXlsx({ summary, rows, filters, lang = 'en', actor }) {
    const t = translator(lang);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = university.shortName;
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(lang === 'ar' ? 'الحضور' : 'Attendance', {
      views: [{ rightToLeft: lang === 'ar', state: 'frozen', ySplit: 9 }]
    });

    sheet.mergeCells('A1:L1');
    const title = sheet.getCell('A1');
    title.value = lang === 'ar' ? `${university.nameAr} — ${t('report.title')}` : `${university.nameEn} — ${t('report.title')}`;
    title.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    title.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 30;

    sheet.mergeCells('A2:L2');
    const subtitle = sheet.getCell('A2');
    subtitle.value = `${t('report.generated')}: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}  •  ${t('report.generatedBy')}: ${actor || 'system'}`;
    subtitle.font = { size: 10, color: { argb: 'FF718092' } };
    subtitle.alignment = { horizontal: 'center' };

    const filterBits = [];
    if (filters.from || filters.to) filterBits.push(`${t('from')}: ${filters.from || '—'}  ${t('to')}: ${filters.to || '—'}`);
    if (filters.courseName) filterBits.push(`${t('course')}: ${filters.courseName}`);
    if (filters.status) filterBits.push(`${t('status')}: ${filters.status}`);
    sheet.mergeCells('A3:L3');
    const filterCell = sheet.getCell('A3');
    filterCell.value = `${t('filters')}: ${filterBits.length ? filterBits.join(' | ') : t('all')}`;
    filterCell.font = { size: 10, italic: true, color: { argb: 'FF315B83' } };
    filterCell.alignment = { horizontal: 'center' };

    const summaryPairs = [
      [t('total'), summary.marked],
      [t('present'), summary.present],
      [t('late'), summary.late],
      [t('excused'), summary.excused],
      [t('absent'), summary.absent],
      [t('attendanceRate'), `${summary.attendanceRate}%`]
    ];
    summaryPairs.forEach(([label, value], index) => {
      const col = index + 1;
      const labelCell = sheet.getCell(5, col);
      labelCell.value = label;
      labelCell.font = { size: 9, bold: true, color: { argb: 'FF718092' } };
      labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      labelCell.alignment = { horizontal: 'center' };
      const valueCell = sheet.getCell(6, col);
      valueCell.value = value;
      valueCell.font = { size: 12, bold: true, color: { argb: NAVY } };
      valueCell.alignment = { horizontal: 'center' };
      valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    });

    const headers = [
      ['studentId', t('studentId')],
      ['studentName', t('student')],
      ['course', t('course')],
      ['lecture', t('lecture')],
      ['date', t('date')],
      ['time', t('time')],
      ['status', t('status')],
      ['source', t('source')],
      ['markedBy', t('markedBy')],
      ['markedAt', t('markedAt')],
      ['level', t('level')],
      ['notes', t('notes')]
    ];

    const headerRow = sheet.getRow(8);
    headers.forEach(([key, label], index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getColumn(index + 1).width = COLUMNS[key]?.width || 16;
    });
    headerRow.height = 22;

    const statusLabel = status => t(`status.${status}`, status);
    rows.forEach((row, index) => {
      const dataRow = sheet.addRow([
        row.studentId,
        row.studentName,
        row.course,
        row.lectureTitle,
        row.lectureDate,
        row.startTime,
        statusLabel(row.status),
        row.source,
        row.markedBy,
        row.markedAt,
        row.level,
        row.note || ''
      ]);
      dataRow.font = { size: 9, color: { argb: 'FF263445' } };
      if (index % 2 === 1) {
        dataRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFC' } };
        });
      }
      const statusCell = dataRow.getCell(7);
      const tones = {
        present: 'FF258269', late: 'FFB8860B', excused: 'FF315B83', absent: 'FFB84545'
      };
      statusCell.font = { size: 9, bold: true, color: { argb: tones[row.status] || 'FF263445' } };
    });

    sheet.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8, column: headers.length } };

    // Course rollup on a second sheet.
    const byCourse = new Map();
    for (const row of rows) {
      const key = row.course || '—';
      if (!byCourse.has(key)) byCourse.set(key, { marked: 0, present: 0, late: 0, excused: 0, absent: 0 });
      const bucket = byCourse.get(key);
      bucket.marked += 1;
      if (bucket[row.status] !== undefined) bucket[row.status] += 1;
    }
    if (byCourse.size) {
      const rollup = workbook.addWorksheet(lang === 'ar' ? 'المقررات' : 'By course', { views: [{ rightToLeft: lang === 'ar' }] });
      rollup.addRow([t('course'), t('marked'), t('present'), t('late'), t('excused'), t('absent'), t('attendanceRate')]);
      rollup.getRow(1).eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      });
      for (const [name, bucket] of byCourse) {
        const rate = bucket.marked ? Math.round(((bucket.present + bucket.late) / bucket.marked) * 1000) / 10 : 0;
        rollup.addRow([name, bucket.marked, bucket.present, bucket.late, bucket.excused, bucket.absent, `${rate}%`]);
      }
      rollup.columns.forEach((column, index) => { column.width = [30, 12, 10, 10, 12, 10, 16][index] || 14; });
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  function pdfDoc({ lang }) {
    const PDFDocument = require('pdfkit');
    const rtl = lang === 'ar';
    return new PDFDocument({
      size: 'A4',
      margin: 36,
      layout: 'landscape',
      bufferPages: true,
      info: { Title: 'Attendance Report', Author: university.nameEn },
      lang: rtl ? 'ar' : 'en'
    });
  }

  function collect(doc) {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
    return { chunks, done };
  }

  function registerFonts(doc) {
    doc.registerFont('Cairo', path.join(FONT_DIR, 'Cairo-Regular.ttf'));
    doc.registerFont('CairoSemi', path.join(FONT_DIR, 'Cairo-SemiBold.ttf'));
    doc.registerFont('CairoBold', path.join(FONT_DIR, 'Cairo-Bold.ttf'));
  }

  function makeWriter(doc, lang) {
    const rtl = lang === 'ar';
    return (value) => {
      const raw = String(value ?? '');
      if (!hasArabic(raw)) return raw;
      return preparePdfText(raw, rtl ? 'rtl' : 'ltr');
    };
  }

  /** Landscape A4 attendance report with summary tiles and a paginated table. */
  async function attendancePdf({ summary, rows, filters, lang = 'en', actor }) {
    const t = translator(lang);
    const rtl = lang === 'ar';
    const doc = pdfDoc({ lang });
    const { done } = collect(doc);
    registerFonts(doc);
    const write = makeWriter(doc, lang);

    const pageWidth = doc.page.width;
    const margin = 36;
    const contentWidth = pageWidth - margin * 2;
    const navy = '#142B45';
    const gold = '#C5A15B';
    const ink = '#263445';
    const muted = '#718092';

    // Header band
    doc.rect(0, 0, pageWidth, 78).fill(navy);
    doc.rect(0, 78, pageWidth, 3).fill(gold);
    doc.fillColor('#ffffff').font('CairoBold').fontSize(17)
      .text(write(rtl ? university.nameAr : university.nameEn), margin, 18, { width: contentWidth, align: rtl ? 'right' : 'left' });
    doc.font('CairoSemi').fontSize(11).fillColor('#C9D6E2')
      .text(write(t('report.title')), margin, 42, { width: contentWidth, align: rtl ? 'right' : 'left' });
    doc.font('Cairo').fontSize(8).fillColor('#9FB3C4')
      .text(`${t('report.generated')}: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}  |  ${t('report.generatedBy')}: ${actor || 'system'}`,
        margin, 58, { width: contentWidth, align: rtl ? 'right' : 'left' });

    let y = 96;
    const filterBits = [];
    if (filters.from || filters.to) filterBits.push(`${t('from')}: ${filters.from || '—'}   ${t('to')}: ${filters.to || '—'}`);
    if (filters.courseName) filterBits.push(`${t('course')}: ${filters.courseName}`);
    if (filters.status) filterBits.push(`${t('status')}: ${t(`status.${filters.status}`)}`);
    doc.fillColor(muted).font('Cairo').fontSize(9)
      .text(write(`${t('filters')}: ${filterBits.length ? filterBits.join('   |   ') : t('all')}`), margin, y, { width: contentWidth, align: rtl ? 'right' : 'left' });

    y += 22;
    // Summary tiles
    const tiles = [
      [t('total'), summary.marked],
      [t('present'), summary.present],
      [t('late'), summary.late],
      [t('excused'), summary.excused],
      [t('absent'), summary.absent],
      [t('attendanceRate'), `${summary.attendanceRate}%`]
    ];
    const tileWidth = (contentWidth - 10 * (tiles.length - 1)) / tiles.length;
    tiles.forEach(([label, value], index) => {
      const x = margin + index * (tileWidth + 10);
      doc.roundedRect(x, y, tileWidth, 52, 5).fillAndStroke('#F5F7FA', '#E4E9EF');
      doc.fillColor(muted).font('Cairo').fontSize(7.5).text(write(label), x + 6, y + 8, { width: tileWidth - 12, align: 'center' });
      doc.fillColor(navy).font('CairoBold').fontSize(15).text(String(value), x + 6, y + 22, { width: tileWidth - 12, align: 'center' });
    });

    y += 70;
    const columns = rtl
      ? [
        { key: 'studentName', label: t('student'), width: 130 },
        { key: 'studentId', label: t('studentId'), width: 78 },
        { key: 'course', label: t('course'), width: 128 },
        { key: 'lectureTitle', label: t('lecture'), width: 132 },
        { key: 'lectureDate', label: t('date'), width: 66 },
        { key: 'startTime', label: t('time'), width: 40 },
        { key: 'status', label: t('status'), width: 58 },
        { key: 'source', label: t('source'), width: 56 },
        { key: 'markedBy', label: t('markedBy'), width: 66 }
      ]
      : [
        { key: 'studentId', label: t('studentId'), width: 74 },
        { key: 'studentName', label: t('student'), width: 122 },
        { key: 'course', label: t('course'), width: 124 },
        { key: 'lectureTitle', label: t('lecture'), width: 128 },
        { key: 'lectureDate', label: t('date'), width: 64 },
        { key: 'startTime', label: t('time'), width: 40 },
        { key: 'status', label: t('status'), width: 56 },
        { key: 'source', label: t('source'), width: 56 },
        { key: 'markedBy', label: t('markedBy'), width: 66 }
      ];

    function drawHeader() {
      const ordered = rtl ? [...columns].reverse() : columns;
      let x = margin;
      doc.rect(margin, y, contentWidth, 20).fill(navy);
      for (const column of ordered) {
        doc.fillColor('#ffffff').font('CairoSemi').fontSize(8)
          .text(write(column.label), x + 4, y + 6, { width: column.width - 8, align: rtl ? 'right' : 'left', lineBreak: false });
        x += column.width;
      }
      y += 20;
    }

    drawHeader();
    const statusLabels = { present: t('status.present'), late: t('status.late'), excused: t('status.excused'), absent: t('status.absent') };
    const tones = { present: '#258269', late: '#B8860B', excused: '#315B83', absent: '#B84545' };

    rows.forEach((row, index) => {
      if (y > doc.page.height - 60) {
        drawFooter(doc, lang, t, margin, contentWidth);
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 36 });
        registerFonts(doc);
        y = 48;
        drawHeader();
      }
      const ordered = rtl ? [...columns].reverse() : columns;
      if (index % 2 === 1) doc.rect(margin, y, contentWidth, 16).fill('#F9FAFC');
      let x = margin;
      for (const column of ordered) {
        const raw = column.key === 'status' ? statusLabels[row.status] || row.status : row[column.key];
        doc.fillColor(column.key === 'status' ? (tones[row.status] || ink) : ink)
          .font(column.key === 'status' ? 'CairoSemi' : 'Cairo')
          .fontSize(7.5)
          .text(write(raw ?? ''), x + 4, y + 4, { width: column.width - 8, align: rtl ? 'right' : 'left', ellipsis: true, lineBreak: false, height: 12 });
        x += column.width;
      }
      y += 16;
    });

    if (!rows.length) {
      doc.fillColor(muted).font('Cairo').fontSize(10).text(write(t('noRecords')), margin, y + 10, { width: contentWidth, align: 'center' });
    }

    drawFooter(doc, lang, t, margin, contentWidth);

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.fillColor(muted).font('Cairo').fontSize(7)
        .text(`${t('page')} ${i + 1} ${t('of')} ${range.count}`, margin, doc.page.height - 26, { width: contentWidth, align: 'center' });
    }

    doc.end();
    return done;
  }

  function drawFooter(doc, lang, t, margin, contentWidth) {
    const rtl = lang === 'ar';
    const y = doc.page.height - 40;
    doc.rect(margin, y - 8, contentWidth, 1).fill('#E4E9EF');
    doc.fillColor('#718092').font('Cairo').fontSize(7)
      .text(preparePdfText(rtl ? `${university.nameAr} · ${t('report.title')}` : `${university.nameEn} · ${t('report.title')}`),
        margin, y, { width: contentWidth, align: rtl ? 'right' : 'left' });
  }

  /** Student-specific transcript (single student, portrait). */
  async function studentPdf({ student, history, summary, lang = 'en', actor }) {
    const PDFDocument = require('pdfkit');
    const t = translator(lang);
    const rtl = lang === 'ar';
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Attendance — ${student.name}` } });
    const { done } = collect(doc);
    registerFonts(doc);
    const write = makeWriter(doc, lang);
    const navy = '#142B45';
    const margin = 40;
    const contentWidth = doc.page.width - margin * 2;

    doc.rect(0, 0, doc.page.width, 92).fill(navy);
    doc.fillColor('#ffffff').font('CairoBold').fontSize(15)
      .text(write(rtl ? university.nameAr : university.nameEn), margin, 22, { width: contentWidth, align: rtl ? 'right' : 'left' });
    doc.font('Cairo').fontSize(10).fillColor('#C9D6E2')
      .text(write(`${t('report.title')} — ${student.name}`), margin, 46, { width: contentWidth, align: rtl ? 'right' : 'left' });
    doc.fontSize(8).fillColor('#9FB3C4')
      .text(`${student.id}  |  ${new Date().toISOString().slice(0, 10)}`, margin, 66, { width: contentWidth, align: rtl ? 'right' : 'left' });

    let y = 112;
    const lines = [
      [t('student'), student.name],
      [t('studentId'), student.id],
      [t('course'), student.course || '—'],
      [t('level'), student.level || '—'],
      [t('attendanceRate'), summary.attendanceRate === null ? '—' : `${summary.attendanceRate}%`],
      [t('present'), summary.present],
      [t('late'), summary.late],
      [t('absent'), summary.absent]
    ];
    lines.forEach(([label, value], index) => {
      const x = margin + (index % 2) * (contentWidth / 2);
      const rowY = y + Math.floor(index / 2) * 20;
      doc.fillColor('#718092').font('Cairo').fontSize(8).text(write(label), x, rowY, { width: contentWidth / 2 - 10, align: rtl ? 'right' : 'left' });
      doc.fillColor('#263445').font('CairoSemi').fontSize(9).text(write(String(value)), x, rowY + 9, { width: contentWidth / 2 - 10, align: rtl ? 'right' : 'left' });
    });
    y += 92;

    const headers = [[t('date'), 70], [t('lecture'), 170], [t('course'), 140], [t('status'), 70], [t('markedAt'), 100]];
    doc.rect(margin, y, contentWidth, 20).fill(navy);
    let x = margin;
    for (const [label, width] of (rtl ? [...headers].reverse() : headers)) {
      doc.fillColor('#ffffff').font('CairoSemi').fontSize(8).text(write(label), x + 4, y + 6, { width: width - 8, align: rtl ? 'right' : 'left', lineBreak: false });
      x += width;
    }
    y += 20;
    const statusLabels = { present: t('status.present'), late: t('status.late'), excused: t('status.excused'), absent: t('status.absent') };
    history.forEach((row, index) => {
      if (y > doc.page.height - 60) {
        doc.addPage({ margin: 40 });
        registerFonts(doc);
        y = 48;
        doc.rect(margin, y, contentWidth, 20).fill(navy);
        let hx = margin;
        for (const [label, width] of (rtl ? [...headers].reverse() : headers)) {
          doc.fillColor('#ffffff').font('CairoSemi').fontSize(8).text(write(label), hx + 4, y + 6, { width: width - 8, align: rtl ? 'right' : 'left', lineBreak: false });
          hx += width;
        }
        y += 20;
      }
      if (index % 2 === 1) doc.rect(margin, y, contentWidth, 16).fill('#F9FAFC');
      const values = [row.lectureDate, row.lectureTitle, row.course, statusLabels[row.status] || row.status, row.markedAt];
      let vx = margin;
      const widths = headers.map(h => h[1]);
      const ordered = rtl ? [...values].reverse() : values;
      const orderedWidths = rtl ? [...widths].reverse() : widths;
      ordered.forEach((value, i) => {
        doc.fillColor('#263445').font('Cairo').fontSize(7.5)
          .text(write(value ?? ''), vx + 4, y + 4, { width: orderedWidths[i] - 8, align: rtl ? 'right' : 'left', lineBreak: false, height: 12, ellipsis: true });
        vx += orderedWidths[i];
      });
      y += 16;
    });
    if (!history.length) {
      doc.fillColor('#718092').font('Cairo').fontSize(9).text(write(t('noRecords')), margin, y + 10, { width: contentWidth, align: 'center' });
    }
    doc.end();
    return done;
  }

  return { attendanceXlsx, attendancePdf, studentPdf };
}

module.exports = { createExportService };
