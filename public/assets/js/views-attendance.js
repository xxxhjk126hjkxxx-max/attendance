/* ==========================================================================
   Attendance records view + QR scanner view + manual attendance marking.
   ========================================================================== */
(function () {
  'use strict';
  const A = window.App;
  const { el, $, $$, icon, i18n, api, toast, modal, confirmDialog, escapeHtml, formatNumber, formatPercent, formatDate, formatTime, todayIso, isoDaysAgo, statusBadge, emptyState, skeletonRows, errorState, pagination, initials } = A;
  const t = (key, vars) => i18n.t(key, vars);
  const { pageHead, button, card, sourceLabel } = window.ViewHelpers;
  const Views = {};

  const SOURCE_LABELS = {
    qr: { en: 'QR scan', ar: 'مسح QR' },
    manual: { en: 'Manual', ar: 'يدوي' },
    correction: { en: 'Correction', ar: 'تصحيح' },
    bulk: { en: 'Bulk', ar: 'جماعي' },
    import: { en: 'Import', ar: 'استيراد' }
  };
  function sourceName(source) {
    const entry = SOURCE_LABELS[source];
    return entry ? entry[i18n.lang] || entry.en : source;
  }

  // ============================================================ ATTENDANCE LIST
  const filters = { search: '', courseId: '', lectureId: '', status: '', from: isoDaysAgo(30), to: todayIso(), page: 1, pageSize: 20 };

  Views.attendance = async function attendanceView(target, params) {
    if (params.get('lectureId')) filters.lectureId = params.get('lectureId');
    target.replaceChildren(pageHead({
      eyebrow: t('nav.attendance'), title: t('attendance.title'), subtitle: t('attendance.subtitle'),
      actions: [
        window.Can('attendance.correct') ? button(t('attendance.audit'), { iconName: 'history', onClick: () => auditModal() }) : null,
        window.Can('attendance.mark') ? button(t('attendance.mark'), { variant: 'btn-primary', iconName: 'clipboard', onClick: () => markAttendanceModal() }) : null
      ].filter(Boolean)
    }));

    const panel = el('section', { class: 'card' });
    panel.innerHTML = `
      <div class="table-toolbar">
        <label class="field-icon search-field">${icon('search')}
          <input class="field" id="at-search" type="search" placeholder="${escapeHtml(t('common.searchPlaceholder'))}" style="width:100%"></label>
        <select class="field" id="at-course"><option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.course'))}</option></select>
        <select class="field" id="at-lecture"><option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.lectures'))}</option></select>
        <select class="field" id="at-status">
          <option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.status'))}</option>
          ${['present', 'late', 'excused', 'absent'].map(status => `<option value="${status}">${escapeHtml(t(`common.${status}`))}</option>`).join('')}
        </select>
        <input class="field" id="at-from" type="date" value="${filters.from}" aria-label="${escapeHtml(t('common.from'))}">
        <input class="field" id="at-to" type="date" value="${filters.to}" aria-label="${escapeHtml(t('common.to'))}">
        <button class="btn btn-sm" id="at-reset">${escapeHtml(t('common.reset'))}</button>
      </div>
      <div id="at-body">${skeletonRows(8)}</div>`;
    target.appendChild(panel);
    const body = $('#at-body', panel);

    async function load() {
      try {
        const query = new URLSearchParams({
          page: filters.page, pageSize: filters.pageSize, search: filters.search,
          status: filters.status, from: filters.from, to: filters.to
        });
        if (filters.courseId) query.set('courseId', filters.courseId);
        if (filters.lectureId) query.set('lectureId', filters.lectureId);
        const data = await api.get(`/api/attendance?${query}`);
        const courseSelect = $('#at-course', panel);
        courseSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.course'))}</option>` +
          (data.filters?.courses || []).map(c => `<option value="${c.id}" ${String(c.id) === String(filters.courseId) ? 'selected' : ''}>${escapeHtml(c.code)} — ${escapeHtml(c.nameEn)}</option>`).join('');
        const lectureSelect = $('#at-lecture', panel);
        lectureSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.lectures'))}</option>` +
          (data.filters?.lectures || []).slice(0, 120).map(l => `<option value="${l.id}" ${String(l.id) === String(filters.lectureId) ? 'selected' : ''}>${escapeHtml(l.lectureDate)} · ${escapeHtml(l.title)}</option>`).join('');
        renderRows(data);
      } catch (error) {
        body.innerHTML = `<div class="card-body">${errorState(error.message)}</div>`;
      }
    }

    function renderRows(data) {
      if (!data.items.length) {
        body.innerHTML = `<div class="card-body">${emptyState({ title: t('attendance.empty'), desc: t('empty.searchDesc'), iconName: 'clipboard' })}</div>`;
        return;
      }
      const wrap = el('div');
      wrap.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr>
          <th>${escapeHtml(t('common.student'))}</th>
          <th>${escapeHtml(t('common.lectures'))}</th>
          <th>${escapeHtml(t('common.date'))}</th>
          <th>${escapeHtml(t('common.status'))}</th>
          <th>${escapeHtml(t('common.source'))}</th>
          <th>${escapeHtml(t('common.recordedBy'))}</th>
          <th style="text-align:end">${escapeHtml(t('common.actions'))}</th>
        </tr></thead>
        <tbody>${data.items.map(row => `<tr>
          <td><div class="cell-user"><span class="avatar">${escapeHtml(initials(row.studentName))}</span>
            <div><b>${escapeHtml(row.studentName)}</b><span class="sub mono">${escapeHtml(row.studentId)}</span></div></div></td>
          <td>${escapeHtml(row.lectureTitle)}<span class="sub">${escapeHtml(row.course || '')}</span></td>
          <td class="mono">${formatDate(row.lectureDate)}<span class="sub">${formatTime(row.startTime)}</span></td>
          <td>${statusBadge(row.status)}</td>
          <td><span class="badge ${escapeHtml(row.source)}">${escapeHtml(sourceName(row.source))}</span></td>
          <td class="text-muted">${escapeHtml(row.markedBy || '—')}<span class="sub">${row.markedAt ? formatDate(row.markedAt, { withTime: true }) : ''}</span></td>
          <td class="actions-cell">
            ${window.Can('attendance.correct') ? `<button class="btn btn-sm" data-correct="${row.id}" aria-label="${escapeHtml(t('attendance.edit'))}">${icon('edit')}</button>` : ''}
            <button class="btn btn-sm" data-audit="${row.id}" aria-label="${escapeHtml(t('attendance.audit'))}">${icon('history')}</button>
            ${window.Can('attendance.delete') ? `<button class="btn btn-sm btn-danger" data-del="${row.id}" data-name="${escapeHtml(row.studentName)}" aria-label="${escapeHtml(t('common.delete'))}">${icon('trash')}</button>` : ''}
          </td></tr>`).join('')}</tbody></table></div>`;
      body.replaceChildren(wrap);
      body.appendChild(pagination(data, page => { filters.page = page; load(); }));

      $$('[data-correct]', wrap).forEach(node => node.addEventListener('click', () => {
        const row = data.items.find(item => String(item.id) === node.dataset.correct);
        correctModal(row, load);
      }));
      $$('[data-audit]', wrap).forEach(node => node.addEventListener('click', () => auditModal(node.dataset.audit)));
      $$('[data-del]', wrap).forEach(node => node.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: t('attendance.deleteTitle'),
          text: t('attendance.deleteText', { name: node.dataset.name }),
          confirmLabel: t('common.delete')
        });
        if (!ok) return;
        try {
          await api.del(`/api/attendance/${node.dataset.del}`);
          toast(t('attendance.deleted'), { type: 'success' });
          load();
        } catch (error) { toast(error.message, { type: 'error' }); }
      }));
    }

    $('#at-search', panel).addEventListener('input', A.debounce(event => {
      filters.search = event.target.value.trim(); filters.page = 1; load();
    }, 320));
    $('#at-course', panel).addEventListener('change', event => { filters.courseId = event.target.value; filters.page = 1; load(); });
    $('#at-lecture', panel).addEventListener('change', event => { filters.lectureId = event.target.value; filters.page = 1; load(); });
    $('#at-status', panel).addEventListener('change', event => { filters.status = event.target.value; filters.page = 1; load(); });
    $('#at-from', panel).addEventListener('change', event => { filters.from = event.target.value; filters.page = 1; load(); });
    $('#at-to', panel).addEventListener('change', event => { filters.to = event.target.value; filters.page = 1; load(); });
    $('#at-reset', panel).addEventListener('click', () => {
      Object.assign(filters, { search: '', courseId: '', lectureId: '', status: '', from: isoDaysAgo(30), to: todayIso(), page: 1 });
      $('#at-search', panel).value = '';
      $('#at-status', panel).value = '';
      $('#at-from', panel).value = filters.from;
      $('#at-to', panel).value = filters.to;
      load();
    });
    load();
  };

  function correctModal(row, onDone) {
    if (!row) return;
    const form = el('form', { class: 'form-grid cols-1', novalidate: true });
    form.innerHTML = `
      <div class="info-grid" style="margin-bottom:6px">
        <div class="info-item"><div class="label">${escapeHtml(t('common.student'))}</div><div class="value">${escapeHtml(row.studentName)}</div></div>
        <div class="info-item"><div class="label">${escapeHtml(t('common.lectures'))}</div><div class="value">${escapeHtml(row.lectureTitle)}</div></div>
        <div class="info-item"><div class="label">${escapeHtml(t('common.date'))}</div><div class="value">${formatDate(row.lectureDate)}</div></div>
        <div class="info-item"><div class="label">${escapeHtml(t('common.status'))}</div><div class="value">${statusBadge(row.status)}</div></div>
      </div>
      <div class="form-field" data-field="status"><label>${escapeHtml(t('attendance.edit'))}</label>
        <select class="field" name="status">${['present', 'late', 'excused', 'absent'].map(status => `<option value="${status}" ${row.status === status ? 'selected' : ''}>${escapeHtml(t(`common.${status}`))}</option>`).join('')}</select></div>
      <div class="form-field" data-field="reason"><label>${escapeHtml(t('common.reason'))} <span class="req">*</span></label>
        <textarea class="field" name="reason" rows="3" required placeholder="${escapeHtml(t('common.reason'))}"></textarea>
        <span class="hint">${escapeHtml(i18n.lang === 'ar' ? 'يُسجل السبب في سجل التدقيق.' : 'The reason is written to the audit trail.')}</span></div>`;
    const submit = el('button', { class: 'btn btn-primary', type: 'button', text: t('common.save') });
    const ref = modal({ title: t('attendance.editTitle'), body: form, footer: [
      el('button', { class: 'btn', type: 'button', text: t('common.cancel'), 'data-close-modal': '' }), submit
    ] });
    submit.addEventListener('click', async () => {
      const data = A.formData(form);
      if (!data.reason || data.reason.trim().length < 3) {
        return A.fieldErrors(form, { reason: i18n.lang === 'ar' ? 'أدخل سببًا واضحًا للتعديل.' : 'Enter a clear reason for the change.' });
      }
      A.busy(submit, true);
      try {
        await api.put(`/api/attendance/${row.id}`, { status: data.status, reason: data.reason });
        toast(t('attendance.corrected'), { type: 'success' });
        ref.close();
        onDone && onDone();
      } catch (error) {
        toast(error.message, { type: 'error' });
      } finally { A.busy(submit, false); }
    });
  }

  // ============================================================ MARK ATTENDANCE
  async function markAttendanceModal(presetLectureId) {
    const body = el('div', { html: `<div class="loading-panel"><span class="spinner"></span>${escapeHtml(t('common.loading'))}</div>` });
    const footer = el('div');
    const ref = modal({
      title: t('attendance.markTitle'), subtitle: t('attendance.markSub'),
      body, size: 'wide', footer: [
        el('button', { class: 'btn', type: 'button', text: t('common.cancel'), 'data-close-modal': '' }),
        footer
      ]
    });
    let lectures = [];
    try {
      const data = await api.get('/api/lectures?limit=200');
      lectures = data.items;
    } catch (error) {
      body.innerHTML = errorState(error.message);
      return;
    }
    if (!lectures.length) {
      body.innerHTML = emptyState({ title: t('scanner.noLectures'), desc: t('lectures.emptyDesc'), iconName: 'calendar' });
      return;
    }
    const options = lectures.map(l => `<option value="${l.id}" ${String(l.id) === String(presetLectureId) ? 'selected' : ''}>${escapeHtml(l.lectureDate)} · ${escapeHtml(l.title)} · ${escapeHtml(l.course)}</option>`).join('');
    body.innerHTML = `
      <div class="form-field" style="margin-bottom:12px"><label>${escapeHtml(t('scanner.selectLecture'))}</label>
        <select class="field" id="mark-lecture">${options}</select></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" id="mark-bulk-actions">
        <button class="btn btn-sm" data-bulk="present">${escapeHtml(i18n.lang === 'ar' ? 'الكل حاضر' : 'Mark all present')}</button>
        <button class="btn btn-sm" data-bulk="absent">${escapeHtml(i18n.lang === 'ar' ? 'الكل غائب' : 'Mark all absent')}</button>
        <button class="btn btn-sm" data-bulk="excused">${escapeHtml(i18n.lang === 'ar' ? 'الكل بعذر' : 'Mark all excused')}</button>
        <span class="grow"></span>
        <input class="field" id="mark-search" type="search" placeholder="${escapeHtml(t('common.search'))}" style="max-width:180px">
      </div>
      <div id="mark-roster" class="mark-grid">${skeletonRows(6)}</div>`;
    const rosterBox = $('#mark-roster', body);
    const lectureSelect = $('#mark-lecture', body);
    let roster = [];
    let dirty = new Map();

    async function loadRoster() {
      rosterBox.innerHTML = skeletonRows(5);
      try {
        const data = await api.get(`/api/lectures/${lectureSelect.value}`);
        roster = data.roster;
        dirty = new Map();
        renderRoster();
        footer.replaceChildren(el('button', {
          class: 'btn btn-primary', type: 'button', text: t('attendance.saveAll'),
          onclick: () => save()
        }));
      } catch (error) {
        rosterBox.innerHTML = errorState(error.message);
      }
    }

    function renderRoster() {
      const term = ($('#mark-search', body)?.value || '').toLowerCase();
      const visible = roster.filter(row => !term || row.name.toLowerCase().includes(term) || String(row.id).toLowerCase().includes(term));
      if (!roster.length) {
        rosterBox.innerHTML = emptyState({ title: t('lectures.empty'), desc: t('common.enrolled') + ': 0', iconName: 'users' });
        return;
      }
      rosterBox.innerHTML = visible.map(row => {
        const status = dirty.has(row.id) ? dirty.get(row.id) : (row.status || '');
        return `<div class="mark-row ${dirty.has(row.id) ? 'changed' : ''}" data-row="${escapeHtml(row.id)}">
          <span class="avatar-sm">${escapeHtml(initials(row.name))}</span>
          <div class="name"><b>${escapeHtml(row.name)}</b><small>${escapeHtml(row.id)} · ${escapeHtml(row.level || '')}</small></div>
          <div class="seg" role="group" aria-label="${escapeHtml(row.name)}">
            ${['present', 'late', 'excused', 'absent'].map(value => `<button type="button" data-status="${value}" aria-pressed="${status === value}">${escapeHtml(t(`common.${value}`))}</button>`).join('')}
          </div>
        </div>`;
      }).join('');
      $$('.mark-row', rosterBox).forEach(node => {
        $$('button[data-status]', node).forEach(buttonNode => buttonNode.addEventListener('click', () => {
          dirty.set(node.dataset.row, buttonNode.dataset.status);
          node.classList.add('changed');
          $$('button[data-status]', node).forEach(b => b.setAttribute('aria-pressed', String(b === buttonNode)));
        }));
      });
    }

    async function save() {
      if (!dirty.size) {
        toast(i18n.lang === 'ar' ? 'لم تغيّر أي حالة.' : 'No changes to save.', { type: 'info' });
        return;
      }
      const entries = Array.from(dirty.entries()).map(([studentId, status]) => ({ studentId, status }));
      const saveButton = footer.querySelector('button');
      A.busy(saveButton, true);
      try {
        const result = await api.post('/api/attendance/bulk', { lectureId: Number(lectureSelect.value), entries });
        toast(`${t('attendance.saved')} · +${result.created} / ↻${result.updated}`, { type: 'success' });
        ref.close();
        if (window.location.hash.startsWith('#/attendance')) window.location.reload();
      } catch (error) {
        toast(error.message, { type: 'error' });
      } finally { A.busy(saveButton, false); }
    }

    lectureSelect.addEventListener('change', loadRoster);
    $$('[data-bulk]', body).forEach(node => node.addEventListener('click', () => {
      const status = node.dataset.bulk;
      roster.forEach(row => dirty.set(row.id, status));
      renderRoster();
    }));
    $('#mark-search', body).addEventListener('input', A.debounce(renderRoster, 200));
    loadRoster();
    return ref;
  }
  Views.markAttendanceModal = markAttendanceModal;
  Views.correctModal = correctModal;

  // ============================================================ AUDIT TRAIL
  async function auditModal(attendanceId) {
    const body = el('div', { html: `<div class="loading-panel"><span class="spinner"></span></div>` });
    modal({ title: t('attendance.auditTitle'), body, size: 'wide' });
    try {
      const query = new URLSearchParams({ pageSize: 100 });
      if (attendanceId) query.set('attendanceId', attendanceId);
      const data = await api.get(`/api/attendance/audit?${query}`);
      if (!data.items.length) {
        body.innerHTML = emptyState({ title: t('audit.empty'), desc: '', iconName: 'history' });
        return;
      }
      body.innerHTML = `<div class="timeline">${data.items.map(item => `
        <div class="timeline-item ${item.newStatus === 'absent' ? 'red' : item.newStatus === 'present' ? 'green' : 'gold'}">
          <b>${escapeHtml(item.studentName)}</b> — ${escapeHtml(item.lectureTitle)}
          <div style="margin-top:4px;font-size:12px">
            <span class="badge ${escapeHtml(item.previousStatus || 'unmarked')}">${escapeHtml(item.previousStatus ? t(`common.${item.previousStatus}`) : t('common.unmarked'))}</span>
            ${icon('arrowRight')}
            <span class="badge ${escapeHtml(item.newStatus)}">${escapeHtml(t(`common.${item.newStatus}`))}</span>
          </div>
          <div class="text-muted" style="margin-top:4px;font-size:11.5px">${escapeHtml(item.reason)} · ${escapeHtml(item.changedBy)}</div>
          <time>${formatDate(item.changedAt, { withTime: true })}</time>
        </div>`).join('')}</div>`;
    } catch (error) {
      body.innerHTML = errorState(error.message);
    }
  }
  Views.auditModal = auditModal;

  // ============================================================ SCANNER
  Views.scanner = async function scannerView(target) {
    if (!window.Can('attendance.mark')) return Views.accessDenied(target);
    target.replaceChildren(pageHead({
      eyebrow: t('nav.scanner'), title: t('scanner.title'), subtitle: t('scanner.subtitle'),
      actions: [button(t('attendance.mark'), { iconName: 'clipboard', onClick: () => markAttendanceModal() })]
    }));

    const layout = el('div', { class: 'scanner' });
    const stageCard = card({
      title: t('scanner.title'),
      actions: `<select class="field" id="scan-lecture" aria-label="${escapeHtml(t('scanner.selectLecture'))}" style="min-width:240px"></select>`,
      body: `
        <div class="scan-stage" id="scan-stage">
          <video id="scan-video" playsinline muted hidden></video>
          <div class="scan-frame" aria-hidden="true"><i></i><span class="scan-laser"></span></div>
          <div class="scan-hint" id="scan-hint">
            ${icon('camera')}
            <div>${escapeHtml(t('scanner.cameraHint'))}</div>
          </div>
          <div class="scan-flash" id="scan-flash"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-primary" id="scan-start">${icon('camera')}<span>${escapeHtml(t('scanner.start'))}</span></button>
          <label class="btn" for="scan-file">${icon('upload')}<span>${escapeHtml(t('scanner.upload'))}</span></label>
          <input id="scan-file" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
          <span class="grow"></span>
          <button class="btn btn-sm" id="scan-session">${escapeHtml(t('scanner.session'))}</button>
          <button class="btn btn-sm btn-gold" id="scan-finalize">${escapeHtml(t('scanner.finalize'))}</button>
        </div>
        <div id="scan-status" class="text-muted" style="margin-top:12px;font-size:12px"></div>`
    });
    const logCard = card({
      title: t('scanner.log'),
      body: `<div class="scan-log" id="scan-log">${emptyState({ title: t('scanner.emptyLog'), desc: '', iconName: 'scan' })}</div>`
    });
    layout.appendChild(stageCard);
    layout.appendChild(logCard);
    target.appendChild(layout);

    const lectureSelect = $('#scan-lecture', stageCard);
    const video = $('#scan-video', stageCard);
    const stage = $('#scan-stage', stageCard);
    const hint = $('#scan-hint', stageCard);
    const flash = $('#scan-flash', stageCard);
    const log = $('#scan-log', logCard);
    const statusLine = $('#scan-status', stageCard);
    const searchParams = new URLSearchParams(window.location.hash.split('?')[1] || '');

    let lectures = [];
    try {
      const data = await api.get('/api/lectures?limit=200');
      lectures = data.items;
    } catch (error) {
      log.innerHTML = errorState(error.message);
      return;
    }
    if (!lectures.length) {
      lectureSelect.outerHTML = `<span class="badge gold">${escapeHtml(t('scanner.noLectures'))}</span>`;
      if (startButton) startButton.disabled = true;
    } else {
      lectureSelect.innerHTML = lectures.map(l => `<option value="${l.id}" ${String(l.id) === searchParams.get('lectureId') ? 'selected' : ''}>${escapeHtml(l.lectureDate)} · ${escapeHtml(l.title)} · ${escapeHtml(l.courseCode || l.course)}</option>`).join('');
    }

    const startButton = $('#scan-start', stageCard);
    const startLabel = startButton ? $('span', startButton) : null;
    const setStartLabel = text => { if (startLabel) startLabel.textContent = text; };

    let stream = null;
    let scanning = false;
    let rafId = null;

    function stopCamera() {
      scanning = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }
      video.hidden = true;
      video.srcObject = null;
      hint.style.display = '';
      hint.innerHTML = `${icon('camera')}<div>${escapeHtml(t('scanner.cameraOff'))}</div>`;
      setStartLabel(t('scanner.start'));
    }

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return showStatus(t('scanner.insecure'), 'error');
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        video.srcObject = stream;
        video.hidden = false;
        hint.style.display = 'none';
        await video.play();
        scanning = true;
        setStartLabel(t('scanner.stop'));
        tick();
      } catch (error) {
        showStatus(t('scanner.cameraError'), 'error');
        stopCamera();
      }
    }

    const canvas = document.createElement('canvas');
    function tick() {
      if (!scanning) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width && height) {
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, width, height);
          const image = ctx.getImageData(0, 0, width, height);
          const code = window.jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) {
            handlePayloadString(code.data);
            // Debounce repeated reads of the same code.
            scanning = false;
            setTimeout(() => { if (stream) scanning = true; }, 2200);
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    let lastPayload = '';
    let lastAt = 0;
    async function handlePayloadString(raw) {
      const now = Date.now();
      if (raw === lastPayload && now - lastAt < 2500) return;
      lastPayload = raw;
      lastAt = now;
      let payload;
      try { payload = JSON.parse(raw); } catch { payload = null; }
      if (!payload || payload.v !== 1 || typeof payload.token !== 'string') {
        flash.classList.add('err');
        setTimeout(() => flash.classList.remove('err'), 600);
        showStatus(t('scanner.invalid'), 'error');
        pushLog({ ok: false, title: t('scanner.invalid'), detail: raw.slice(0, 40) });
        return;
      }
      const lectureId = Number(lectureSelect.value);
      if (!lectureId) {
        showStatus(t('scanner.selectLectureHint'), 'warn');
        return;
      }
      try {
        const result = await api.post('/api/attendance/scan', { lectureId, qr: payload });
        flash.classList.add('ok');
        setTimeout(() => flash.classList.remove('ok'), 600);
        showStatus(`${t('scanner.success')} · ${result.item.studentName}`, 'success');
        pushLog({ ok: true, title: result.item.studentName, detail: `${result.item.studentId} · ${t(`common.${result.item.status}`)}` });
        if (navigator.vibrate) navigator.vibrate(60);
      } catch (error) {
        flash.classList.add('err');
        setTimeout(() => flash.classList.remove('err'), 600);
        const isDuplicate = error.status === 409;
        showStatus(error.message, isDuplicate ? 'warn' : 'error');
        pushLog({ ok: false, title: isDuplicate ? t('scanner.duplicate') : t('scanner.invalid'), detail: error.message });
      }
    }

    function pushLog({ ok, title, detail }) {
      if ($('.empty', log)) log.innerHTML = '';
      const entry = el('div', { class: `scan-entry ${ok ? 'success' : 'error'}` });
      entry.innerHTML = `
        <span class="avatar-sm" style="background:${ok ? 'var(--green-soft)' : 'var(--red-soft)'};color:${ok ? 'var(--green)' : 'var(--red)'}">${ok ? icon('check') : icon('x')}</span>
        <div class="meta"><b>${escapeHtml(title)}</b><small>${escapeHtml(detail || '')}</small></div>
        <time>${new Date().toLocaleTimeString(i18n.lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</time>`;
      log.prepend(entry);
      while (log.children.length > 40) log.lastChild.remove();
    }

    function showStatus(message, type) {
      statusLine.textContent = message;
      statusLine.style.color = type === 'error' ? 'var(--red)' : type === 'warn' ? 'var(--amber)' : type === 'success' ? 'var(--green)' : 'var(--muted)';
    }

    startButton && startButton.addEventListener('click', () => {
      if (scanning) stopCamera();
      else startCamera();
    });

    $('#scan-file', stageCard).addEventListener('change', async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      showStatus(t('scanner.uploading'), 'info');
      try {
        if (window.jsQR && file.type === 'image/png') {
          // Prefer client-side decode so no upload is needed for PNG screenshots.
          const raw = await decodeLocalImage(file);
          if (raw) return handlePayloadString(raw);
        }
        const result = await api.post('/api/qr/decode', file);
        await handleDecodedServer(result);
      } catch (error) {
        showStatus(error.message, 'error');
        pushLog({ ok: false, title: t('scanner.invalid'), detail: error.message });
      } finally {
        event.target.value = '';
      }
    });

    async function handleDecodedServer(result) {
      const lectureId = Number(lectureSelect.value);
      if (!lectureId) return showStatus(t('scanner.selectLectureHint'), 'warn');
      try {
        const response = await api.post('/api/attendance/scan', { lectureId, qr: result.qr });
        flash.classList.add('ok');
        setTimeout(() => flash.classList.remove('ok'), 600);
        showStatus(`${t('scanner.success')} · ${response.item.studentName}`, 'success');
        pushLog({ ok: true, title: response.item.studentName, detail: `${response.item.studentId} · ${t(`common.${response.item.status}`)}` });
      } catch (error) {
        flash.classList.add('err');
        setTimeout(() => flash.classList.remove('err'), 600);
        showStatus(error.message, error.status === 409 ? 'warn' : 'error');
        pushLog({ ok: false, title: error.status === 409 ? t('scanner.duplicate') : t('scanner.invalid'), detail: error.message });
      }
    }

    function decodeLocalImage(file) {
      return new Promise(resolve => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
          const off = document.createElement('canvas');
          const max = 1200;
          const scale = Math.min(1, max / Math.max(image.width, image.height));
          off.width = Math.round(image.width * scale);
          off.height = Math.round(image.height * scale);
          const ctx = off.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(image, 0, 0, off.width, off.height);
          const data = ctx.getImageData(0, 0, off.width, off.height);
          const code = window.jsQR(data.data, off.width, off.height, { inversionAttempts: 'attemptBoth' });
          URL.revokeObjectURL(url);
          resolve(code && code.data ? code.data : null);
        };
        image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        image.src = url;
      });
    }

    $('#scan-session', stageCard).addEventListener('click', async () => {
      try {
        await api.post(`/api/lectures/${lectureSelect.value}/open-session`, {});
        toast(t('scanner.session'), { type: 'success' });
      } catch (error) { toast(error.message, { type: 'error' }); }
    });

    $('#scan-finalize', stageCard).addEventListener('click', async () => {
      const ok = await confirmDialog({ title: t('scanner.finalize'), text: t('scanner.finalizeConfirm'), confirmLabel: t('common.confirm'), danger: false });
      if (!ok) return;
      try {
        const result = await api.post(`/api/lectures/${lectureSelect.value}/finalize`, {});
        toast(t('scanner.finalized', { n: result.markedAbsent }), { type: 'success' });
      } catch (error) { toast(error.message, { type: 'error' }); }
    });

    stage.addEventListener('click', event => {
      if (event.target.closest('#scan-start')) return;
      if (!stream && window.isSecureContext !== false) startCamera();
    });

    if (!window.isSecureContext) {
      showStatus(t('scanner.insecure'), 'warn');
    }

    // Stop the camera when leaving the page.
    const observer = new MutationObserver(() => {
      if (!document.body.contains(stage)) {
        stopCamera();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  window.Views = Object.assign(window.Views || {}, Views);
  window.ViewHelpers = Object.assign(window.ViewHelpers || {}, { sourceName, markAttendanceModal, auditModal });
})();
