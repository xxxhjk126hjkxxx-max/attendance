/* ==========================================================================
   Route views. Each view receives the page container and URL params.
   ========================================================================== */
(function () {
  'use strict';
  const A = window.App;
  const { el, $, $$, icon, i18n, api, state, toast, modal, confirmDialog, escapeHtml, formatNumber, formatPercent, formatDate, formatTime, todayIso, isoDaysAgo, statusBadge, emptyState, skeletonRows, errorState, highlight, pagination, initials } = A;
  const t = (key, vars) => i18n.t(key, vars);
  const Views = {};

  // ------------------------------------------------------------ helpers
  function pageHead({ eyebrow, title, subtitle, actions }) {
    const head = el('div', { class: 'page-head' });
    head.innerHTML = `
      <div>
        ${eyebrow ? `<div class="eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
      </div>
    `;
    if (actions && actions.length) {
      const wrap = el('div', { class: 'page-actions' });
      actions.forEach(node => node && wrap.appendChild(node));
      head.appendChild(wrap);
    }
    return head;
  }

  function button(label, { variant = '', iconName, onClick, size = '', type = 'button', attrs = {} } = {}) {
    const node = el('button', Object.assign({ class: `btn ${variant} ${size}`.trim(), type }, attrs));
    if (iconName) node.innerHTML = icon(iconName);
    if (label) node.appendChild(el('span', { text: label }));
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function card({ title, subtitle, actions, body, padded = true, class: extra = '' }) {
    const node = el('section', { class: `card ${extra}` });
    if (title || actions) {
      const head = el('div', { class: 'card-head' });
      head.innerHTML = `<div><h3>${escapeHtml(title || '')}</h3>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>`;
      if (actions) {
        const wrap = el('div', { class: 'actions' });
        if (typeof actions === 'string') {
          wrap.innerHTML = actions;
        } else {
          (Array.isArray(actions) ? actions : [actions]).forEach(a => {
            if (!a) return;
            if (typeof a === 'string') wrap.insertAdjacentHTML('beforeend', a);
            else wrap.appendChild(a);
          });
        }
        head.appendChild(wrap);
      }
      node.appendChild(head);
    }
    const content = el('div', { class: padded ? 'card-body' : '' });
    if (typeof body === 'string') content.innerHTML = body;
    else if (body) content.appendChild(body);
    node.appendChild(content);
    return node;
  }

  function loadingCard(target, rows) {
    target.replaceChildren(el('div', { class: 'card', html: `<div class="card-body">${skeletonRows(rows || 6)}</div>` }));
  }

  function sourceLabel(source) {
    const map = { qr: t('common.source') === 'Source' ? 'QR scan' : 'مسح QR', manual: 'Manual', correction: 'Correction', bulk: 'Bulk', import: 'Import' };
    return map[source] || source;
  }

  async function guard(target, loader) {
    try {
      return await loader();
    } catch (error) {
      if (error.status === 401) return null;
      target.replaceChildren(el('div', { class: 'card', html: `<div class="card-body">${errorState(error.message)}</div>` }));
      return null;
    }
  }

  function trendPill(current, previous) {
    if (previous === undefined || previous === null || current === undefined || current === null) return '';
    const delta = Number(current) - Number(previous);
    const cls = Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'down';
    const arrow = cls === 'up' ? 'arrowUp' : cls === 'down' ? 'arrowDown' : 'dots';
    return `<span class="trend-pill ${cls}">${icon(arrow)}${delta > 0 ? '+' : ''}${formatNumber(delta, 1)}</span>`;
  }

  // ============================================================ DASHBOARD
  Views.dashboard = async function dashboard(target) {
    target.replaceChildren(el('div', { class: 'page-head', html: `
      <div><div class="eyebrow">${escapeHtml(t('dash.eyebrow'))}</div>
      <h1>${escapeHtml(t('dash.title'))}</h1><p>${escapeHtml(t('dash.subtitle'))}</p></div>` }));
    const loading = el('div', { class: 'stack' });
    loading.innerHTML = `<div class="stat-grid">${Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
      <div class="skeleton" style="height:320px;border-radius:16px"></div>`;
    target.appendChild(loading);

    let data;
    try {
      data = await api.get('/api/dashboard');
    } catch (error) {
      loading.replaceChildren(el('div', { class: 'card', html: `<div class="card-body">${errorState(error.message)}</div>` }));
      return;
    }
    loading.remove();
    const s = data.stats;
    const periods = data.periods;

    const stats = el('div', { class: 'stat-grid' });
    const statCard = ({ label, value, foot, accent, iconName, suffix, extra, progress }) => `
      <article class="stat" style="--accent:${accent}">
        <div class="stat-top"><span class="stat-label">${escapeHtml(label)}</span>
          <span class="stat-icon">${icon(iconName)}</span></div>
        <div class="stat-value">${value}${suffix || ''}</div>
        ${progress !== undefined ? `<div class="progress"><span style="width:${Math.min(100, progress)}%"></span></div>` : ''}
        <div class="stat-foot">${foot || ''}${extra || ''}</div>
      </article>`;

    stats.innerHTML = [
      statCard({
        label: t('dash.totalStudents'), value: formatNumber(s.totalStudents), accent: '#315B83', iconName: 'users',
        foot: `${formatNumber(s.activeStudents)} ${t('dash.registered').toLowerCase()}`
      }),
      statCard({
        label: t('dash.presentToday'), value: formatNumber(s.presentToday), accent: '#258269', iconName: 'checkCircle',
        foot: t('dash.ofRosterToday', { n: formatNumber(s.rosterToday) }),
        extra: trendPill(periods.today.attendanceRate, periods.previousWeek.attendanceRate)
      }),
      statCard({
        label: t('dash.absentToday'), value: formatNumber(s.absentToday), accent: '#B84545', iconName: 'x',
        foot: `${formatNumber(s.unmarkedToday)} ${t('common.unmarked')}`
      }),
      statCard({
        label: t('dash.rate'), value: formatPercent(s.attendanceRate), accent: '#C5A15B', iconName: 'activity',
        progress: s.attendanceRate, foot: t('dash.vsLastWeek'),
        extra: trendPill(periods.week.attendanceRate, periods.previousWeek.attendanceRate)
      })
    ].join('');
    target.appendChild(stats);

    const stats2 = el('div', { class: 'stat-grid cols-3 section-gap' });
    stats2.innerHTML = [
      statCard({ label: t('dash.lateToday'), value: formatNumber(s.lateToday), accent: '#B8860B', iconName: 'clock', foot: t('common.today') }),
      statCard({ label: t('dash.excused'), value: formatNumber(s.excusedToday), accent: '#2A7F8E', iconName: 'shield', foot: t('common.today') }),
      statCard({ label: `${t('dash.totalCourses')} · ${t('dash.totalLectures')}`, value: formatNumber(s.totalCourses), accent: '#5F4B86', iconName: 'book', foot: `${formatNumber(s.totalLectures)} ${t('common.lectures').toLowerCase()} · ${formatNumber(s.lecturesToday)} ${t('common.today').toLowerCase()}` })
    ].join('');
    target.appendChild(stats2);

    // Trend + breakdown
    const trendCard = card({
      title: t('dash.trendTitle'), subtitle: t('dash.trendSub'),
      actions: el('div', { class: 'chart-legend', html: `<span><i style="background:#315B83"></i>${escapeHtml(t('common.attendanceRate'))}</span>` }),
      body: A.lineChart(data.trend.map(row => ({
        label: row.date.slice(5),
        value: row.attendanceRate,
        title: `${row.date}: ${row.attendanceRate}% · ${row.present + row.late}/${row.roster}`
      })), { color: '#315B83', ariaLabel: t('dash.trendTitle') })
    });
    const breakdownCard = card({
      title: t('dash.breakdown'), subtitle: `${formatDate(new Date())}`,
      body: `<div id="donut-slot"></div>
        <div class="divider"></div>
        <div class="info-grid">
          <div class="info-item"><div class="label">${escapeHtml(t('common.present'))}</div><div class="value">${formatNumber(periods.today.present)}</div></div>
          <div class="info-item"><div class="label">${escapeHtml(t('common.late'))}</div><div class="value">${formatNumber(periods.today.late)}</div></div>
          <div class="info-item"><div class="label">${escapeHtml(t('common.excused'))}</div><div class="value">${formatNumber(periods.today.excused)}</div></div>
          <div class="info-item"><div class="label">${escapeHtml(t('common.absent'))}</div><div class="value">${formatNumber(periods.today.absent)}</div></div>
        </div>`
    });
    const donutSlot = $('#donut-slot', breakdownCard);
    donutSlot.innerHTML = A.donutChart([
      { label: t('common.present'), value: periods.today.present, color: '#258269' },
      { label: t('common.late'), value: periods.today.late, color: '#C5A15B' },
      { label: t('common.excused'), value: periods.today.excused, color: '#315B83' },
      { label: t('common.absent'), value: periods.today.absent, color: '#B84545' }
    ], { centerValue: formatPercent(periods.today.attendanceRate), centerLabel: t('common.attendanceRate'), size: 150, stroke: 20 });

    const row1 = el('div', { class: 'two-col section-gap' }, [trendCard, breakdownCard]);
    target.appendChild(row1);

    // Today's lectures + recent activity
    const todayCard = card({
      title: t('dash.todayTitle'), subtitle: t('dash.todaySub'), padded: false,
      actions: button(t('dash.markAttendance'), { variant: 'btn-ghost btn-sm', iconName: 'clipboard', onClick: () => { location.hash = '#/attendance'; } }),
      body: data.todayLectures.length
        ? `<div class="table-wrap"><table class="data"><thead><tr>
            <th>${escapeHtml(t('common.lectures'))}</th><th>${escapeHtml(t('common.course'))}</th>
            <th>${escapeHtml(t('common.time'))}</th><th>${escapeHtml(t('common.status'))}</th><th></th></tr></thead>
            <tbody>${data.todayLectures.map(lec => `
              <tr>
                <td><b>${escapeHtml(lec.title)}</b><span class="sub">${escapeHtml(lec.instructorName || '—')}${lec.room ? ` · ${escapeHtml(lec.room)}` : ''}</span></td>
                <td>${escapeHtml(lec.course)}<span class="sub">${escapeHtml(lec.courseCode || '')}</span></td>
                <td class="mono">${formatTime(lec.startTime)} – ${formatTime(lec.endTime)}</td>
                <td>${lec.marked}/${lec.enrolled} <span class="sub">${formatPercent(lec.enrolled ? Math.round(lec.attended / lec.enrolled * 1000) / 10 : 0)}</span></td>
                <td class="actions-cell"><button class="btn btn-sm" data-lecture="${lec.id}">${escapeHtml(t('lectures.roster'))}</button></td>
              </tr>`).join('')}</tbody></table></div>`
        : emptyState({ title: t('dash.noLecturesToday'), desc: t('lectures.emptyDesc'), iconName: 'calendar',
          action: `<a class="btn btn-sm" href="#/lectures">${escapeHtml(t('lectures.add'))}</a>` })
    });
    $$('[data-lecture]', todayCard).forEach(node => node.addEventListener('click', () => {
      location.hash = `#/lectures?lectureId=${node.dataset.lecture}`;
    }));

    const recentCard = card({
      title: t('dash.recentTitle'), padded: false,
      actions: button(t('common.all'), { variant: 'btn-ghost btn-sm', onClick: () => { location.hash = '#/attendance'; } }),
      body: data.recentActivity.length
        ? `<div>${data.recentActivity.map(row => `
          <div class="list-row">
            <span class="avatar-sm">${escapeHtml(initials(row.studentName))}</span>
            <div class="meta"><b>${escapeHtml(row.studentName)}</b>
              <small>${escapeHtml(row.lectureTitle)} · ${escapeHtml(row.course)}</small></div>
            <div class="side">${statusBadge(row.status)}<div style="margin-top:3px">${formatTime(row.markedAt.split(' ')[1])}</div></div>
          </div>`).join('')}</div>`
        : emptyState({ title: t('dash.noActivity'), desc: t('empty.desc'), iconName: 'clock' })
    });
    target.appendChild(el('div', { class: 'two-col section-gap' }, [todayCard, recentCard]));

    // Course performance + alerts
    const courseCard = card({
      title: t('dash.courseTitle'), subtitle: t('dash.courseSub'), padded: false,
      body: data.coursePerformance.length
        ? `<div>${data.coursePerformance.map(course => `
          <div class="list-row">
            <div class="meta"><b>${escapeHtml(i18n.lang === 'ar' && course.nameAr ? course.nameAr : course.nameEn)}</b>
              <small>${escapeHtml(course.code)} · ${formatNumber(course.students)} ${t('courses.students').toLowerCase()} · ${formatNumber(course.lectures)} ${t('common.lectures').toLowerCase()}</small></div>
            <div class="side" style="min-width:120px">
              <div style="display:flex;justify-content:flex-end;gap:6px;align-items:center">
                <b style="color:var(--ink-strong)">${formatPercent(course.attendanceRate)}</b>
              </div>
              <div class="progress" style="margin-top:5px"><span style="width:${Math.min(100, course.attendanceRate)}%;background:${course.attendanceRate >= 80 ? '#258269' : course.attendanceRate >= 60 ? '#C5A15B' : '#B84545'}"></span></div>
            </div>
          </div>`).join('')}</div>`
        : emptyState({ title: t('courses.empty'), desc: t('courses.emptyDesc'), iconName: 'book' })
    });

    const alertsCard = card({
      title: t('dash.alertsTitle'), subtitle: t('dash.alertsSub'), padded: false,
      body: data.absenceAlerts.length
        ? `<div>${data.absenceAlerts.map(alert => `
          <div class="list-row">
            <span class="avatar-sm" style="background:var(--red-soft);color:var(--red)">${formatNumber(alert.absences)}</span>
            <div class="meta"><b>${escapeHtml(alert.name)}</b><small>${escapeHtml(alert.studentId)} · ${escapeHtml(alert.level || '')}</small></div>
            <div class="side"><span class="badge absent">${formatPercent(alert.attendanceRate)}</span></div>
          </div>`).join('')}</div>`
        : emptyState({ title: t('dash.noAlerts'), desc: '', iconName: 'checkCircle' })
    });
    target.appendChild(el('div', { class: 'two-col section-gap' }, [courseCard, alertsCard]));

    // Weekly/monthly + quick actions
    const weeklyCard = card({
      title: t('dash.weekly'), subtitle: t('dash.trendSub'),
      body: A.barChart(data.weeklySeries.map(row => ({
        label: row.to ? row.to.slice(5) : '',
        value: row.attendanceRate,
        color: row.attendanceRate >= 80 ? '#258269' : row.attendanceRate >= 60 ? '#C5A15B' : '#B84545',
        title: `${row.from} → ${row.to}: ${row.attendanceRate}%`
      })), { max: 100, unit: '%', height: 200, ariaLabel: t('dash.weekly') })
    });
    const quickCard = card({
      title: t('dash.quickTitle'),
      body: `<div class="chip-row" style="gap:10px">
        ${[
          ['dash.markAttendance', 'clipboard', '#/attendance', 'attendance.mark'],
          ['dash.addStudent', 'users', '#/students?action=new', 'students.manage'],
          ['dash.newLecture', 'calendar', '#/lectures?action=new', 'lectures.manage'],
          ['dash.newCourse', 'book', '#/courses?action=new', 'courses.manage'],
          ['dash.viewReports', 'chart', '#/reports', 'reports.view'],
          ['dash.qrCards', 'qr', '#/qr', 'qr.view']
        ].filter(([, , , permission]) => window.Can && window.Can(permission)).map(([label, iconName, href]) =>
          `<a class="btn" href="${href}" style="justify-content:flex-start;flex:1 1 45%">${icon(iconName)}<span>${escapeHtml(t(label))}</span></a>`
        ).join('')}
      </div>
      <div class="divider"></div>
      <div class="info-grid">
        <div class="info-item"><div class="label">${escapeHtml(t('common.week'))}</div><div class="value">${formatPercent(periods.week.attendanceRate)}</div></div>
        <div class="info-item"><div class="label">${escapeHtml(t('common.month'))}</div><div class="value">${formatPercent(periods.month.attendanceRate)}</div></div>
        <div class="info-item"><div class="label">${escapeHtml(t('common.lectures'))}</div><div class="value">${formatNumber(periods.month.lectures)}</div></div>
      </div>`
    });
    target.appendChild(el('div', { class: 'two-col section-gap' }, [weeklyCard, quickCard]));

    if (data.unmarkedLectures.length) {
      const unmarkedCard = card({
        title: t('dash.unmarkedTitle'), subtitle: t('dash.unmarkedSub'), padded: false,
        body: `<div class="table-wrap"><table class="data"><thead><tr>
          <th>${escapeHtml(t('common.lectures'))}</th><th>${escapeHtml(t('common.course'))}</th>
          <th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.enrolled'))}</th><th></th></tr></thead>
          <tbody>${data.unmarkedLectures.map(row => `<tr>
            <td><b>${escapeHtml(row.title)}</b></td><td>${escapeHtml(row.course)}</td>
            <td>${formatDate(row.lectureDate)}</td><td>${formatNumber(row.marked)} / ${formatNumber(row.enrolled)}</td>
            <td class="actions-cell"><a class="btn btn-sm" href="#/attendance?lectureId=${row.id}">${escapeHtml(t('attendance.mark'))}</a></td>
          </tr>`).join('')}</tbody></table></div>`
      });
      target.appendChild(el('div', { class: 'section-gap' }, [unmarkedCard]));
    }
  };

  // ============================================================ STUDENTS
  let studentsState = { page: 1, pageSize: 10, search: '', course: '', level: '', status: '', sort: 'name', dir: 'asc' };

  Views.students = async function studentsView(target, params) {
    if (params.get('search')) studentsState.search = params.get('search');
    const addButton = button(t('students.add'), { variant: 'btn-primary', iconName: 'plus', onClick: () => studentForm() });
    const exportButton = button(t('reports.exportXlsx'), { iconName: 'download', onClick: () => {
      const query = new URLSearchParams();
      if (studentsState.search) query.set('search', studentsState.search);
      api.download(`/api/reports/export/xlsx?${query}`, `students-${todayIso()}.xlsx`).catch(error => toast(error.message, { type: 'error' }));
    } });
    target.replaceChildren(pageHead({
      eyebrow: t('nav.students'), title: t('students.title'), subtitle: t('students.subtitle'),
      actions: [exportButton, window.Can('students.manage') ? addButton : null]
    }));

    const tableCard = el('section', { class: 'card' });
    tableCard.innerHTML = `
      <div class="table-toolbar">
        <label class="field-icon search-field">${icon('search')}
          <input class="field" id="st-search" type="search" placeholder="${escapeHtml(t('common.searchPlaceholder'))}" value="${escapeHtml(studentsState.search)}" style="width:100%">
        </label>
        <select class="field" id="st-course" aria-label="${escapeHtml(t('common.course'))}"></select>
        <select class="field" id="st-level" aria-label="${escapeHtml(t('common.level'))}"></select>
        <select class="field" id="st-status" aria-label="${escapeHtml(t('common.status'))}">
          <option value="">${escapeHtml(t('common.all'))}</option>
          ${['active', 'suspended', 'graduated', 'withdrawn'].map(status => `<option value="${status}">${escapeHtml(t(`students.status.${status}`))}</option>`).join('')}
        </select>
        <button class="btn btn-sm" id="st-clear">${escapeHtml(t('common.reset'))}</button>
      </div>
      <div id="st-body"><div class="card-body">${skeletonRows(8)}</div></div>
    `;
    target.appendChild(tableCard);

    const body = $('#st-body', tableCard);
    const searchInput = $('#st-search', tableCard);
    const courseSelect = $('#st-course', tableCard);
    const levelSelect = $('#st-level', tableCard);
    const statusSelect = $('#st-status', tableCard);
    statusSelect.value = studentsState.status;

    async function load() {
      try {
        const query = new URLSearchParams({
          page: studentsState.page, pageSize: studentsState.pageSize,
          search: studentsState.search, course: studentsState.course,
          level: studentsState.level, status: studentsState.status,
          sort: studentsState.sort, dir: studentsState.dir
        });
        const data = await api.get(`/api/students?${query}`);
        if (data.filters) {
          courseSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.course'))}</option>` +
            data.filters.courses.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
          courseSelect.value = studentsState.course;
          levelSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.level'))}</option>` +
            data.filters.levels.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
          levelSelect.value = studentsState.level;
        }
        render(data);
      } catch (error) {
        body.innerHTML = `<div class="card-body">${errorState(error.message)}</div>`;
      }
    }

    function render(data) {
      if (!data.items.length) {
        body.innerHTML = data.total === 0 && !studentsState.search && !studentsState.course
          ? `<div class="card-body">${emptyState({ title: t('students.empty'), desc: t('students.emptyDesc'), iconName: 'users' })}</div>`
          : `<div class="card-body">${emptyState({ title: t('empty.search'), desc: t('empty.searchDesc'), iconName: 'search' })}</div>`;
        return;
      }
      const table = el('div', {});
      table.innerHTML = `
        <div class="table-wrap"><table class="data">
          <thead><tr>
            <th class="sortable" data-sort="name">${escapeHtml(t('common.student'))}${sortArrow('name')}</th>
            <th class="sortable" data-sort="id">${escapeHtml(t('common.studentId'))}${sortArrow('id')}</th>
            <th>${escapeHtml(t('common.course'))}</th>
            <th class="sortable" data-sort="level">${escapeHtml(t('common.level'))}${sortArrow('level')}</th>
            <th>${escapeHtml(t('common.status'))}</th>
            <th>${escapeHtml(t('common.attendanceRate'))}</th>
            <th style="text-align:end">${escapeHtml(t('common.actions'))}</th>
          </tr></thead>
          <tbody>${data.items.map(student => `
            <tr>
              <td><div class="cell-user"><span class="avatar">${escapeHtml(initials(student.name))}</span>
                <div><b>${highlight(student.name, studentsState.search)}</b>
                <span class="sub">${escapeHtml(student.email || student.phone || '—')}</span></div></div></td>
              <td class="mono">${highlight(student.id, studentsState.search)}</td>
              <td>${escapeHtml(student.course || '—')}</td>
              <td>${escapeHtml(student.level || '—')}</td>
              <td><span class="badge ${student.status === 'active' ? 'present' : student.status === 'suspended' ? 'absent' : 'navy'}">${escapeHtml(t(`students.status.${student.status}`) || student.status)}</span></td>
              <td class="mono">${formatNumber(student.attendanceCount)}</td>
              <td class="actions-cell">
                <button class="btn btn-sm" data-profile="${escapeHtml(student.id)}">${icon('eye')}<span class="hide-sm">${escapeHtml(t('students.viewProfile'))}</span></button>
                ${window.Can('students.manage') ? `<button class="btn btn-sm" data-edit="${escapeHtml(student.id)}" aria-label="${escapeHtml(t('common.edit'))}">${icon('edit')}</button>
                <button class="btn btn-sm btn-danger" data-delete="${escapeHtml(student.id)}" aria-label="${escapeHtml(t('common.delete'))}">${icon('trash')}</button>` : ''}
              </td>
            </tr>`).join('')}</tbody>
        </table></div>`;
      body.replaceChildren(table);
      body.appendChild(pagination(data, page => { studentsState.page = page; load(); }));
      $$('th.sortable', table).forEach(th => th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (studentsState.sort === field) studentsState.dir = studentsState.dir === 'asc' ? 'desc' : 'asc';
        else { studentsState.sort = field; studentsState.dir = 'asc'; }
        studentsState.page = 1;
        load();
      }));
      $$('[data-profile]', table).forEach(node => node.addEventListener('click', () => studentProfile(node.dataset.profile)));
      $$('[data-edit]', table).forEach(node => node.addEventListener('click', () => studentForm(node.dataset.edit)));
      $$('[data-delete]', table).forEach(node => node.addEventListener('click', async () => {
        const student = data.items.find(item => item.id === node.dataset.delete);
        const confirmed = await confirmDialog({
          title: t('students.deleteTitle'),
          text: t('students.deleteText', { name: student ? student.name : node.dataset.delete }),
          confirmLabel: t('common.delete')
        });
        if (!confirmed) return;
        try {
          await api.del(`/api/students/${encodeURIComponent(node.dataset.delete)}`);
          toast(t('students.deleted'), { type: 'success' });
          load();
        } catch (error) { toast(error.message, { type: 'error' }); }
      }));
    }

    function sortArrow(field) {
      if (studentsState.sort !== field) return '';
      return `<span class="sort-arrow">${studentsState.dir === 'asc' ? '▲' : '▼'}</span>`;
    }

    searchInput.addEventListener('input', A.debounce(() => {
      studentsState.search = searchInput.value.trim();
      studentsState.page = 1;
      load();
    }, 320));
    courseSelect.addEventListener('change', () => { studentsState.course = courseSelect.value; studentsState.page = 1; load(); });
    levelSelect.addEventListener('change', () => { studentsState.level = levelSelect.value; studentsState.page = 1; load(); });
    statusSelect.addEventListener('change', () => { studentsState.status = statusSelect.value; studentsState.page = 1; load(); });
    $('#st-clear', tableCard).addEventListener('click', () => {
      studentsState = { page: 1, pageSize: 10, search: '', course: '', level: '', status: '', sort: 'name', dir: 'asc' };
      searchInput.value = '';
      statusSelect.value = '';
      load();
    });

    load();
    if (params.get('action') === 'new' && window.Can('students.manage')) studentForm();
  };

  async function studentForm(id) {
    let student = { status: 'active' };
    let options = { courses: [], levels: [] };
    try {
      options = await api.get('/api/students/options');
      if (id) student = (await api.get(`/api/students/${encodeURIComponent(id)}`)).item;
    } catch (error) { toast(error.message, { type: 'error' }); return; }

    const form = el('form', { class: 'form-grid', novalidate: true });
    form.innerHTML = `
      <div class="form-field" data-field="id"><label>${escapeHtml(t('students.field.id'))} <span class="req">*</span></label>
        <input class="field" name="id" value="${escapeHtml(student.id || '')}" ${id ? 'readonly' : ''} required maxlength="40" placeholder="2026-0001">
        <span class="error"></span></div>
      <div class="form-field" data-field="name"><label>${escapeHtml(t('students.field.name'))} <span class="req">*</span></label>
        <input class="field" name="name" value="${escapeHtml(student.name || '')}" required maxlength="100">
        <span class="error"></span></div>
      <div class="form-field" data-field="course"><label>${escapeHtml(t('students.field.course'))}</label>
        <input class="field" name="course" value="${escapeHtml(student.course || '')}" list="course-options" maxlength="100">
        <datalist id="course-options">${options.courses.map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
        <span class="hint">${escapeHtml(t('courses.enrollHint'))}</span><span class="error"></span></div>
      <div class="form-field" data-field="level"><label>${escapeHtml(t('students.field.level'))} <span class="req">*</span></label>
        <input class="field" name="level" value="${escapeHtml(student.level || '')}" list="level-options" required maxlength="60">
        <datalist id="level-options">${options.levels.map(l => `<option value="${escapeHtml(l)}"></option>`).join('')}</datalist>
        <span class="error"></span></div>
      <div class="form-field" data-field="email"><label>${escapeHtml(t('students.field.email'))}</label>
        <input class="field" name="email" type="email" value="${escapeHtml(student.email || '')}" maxlength="160">
        <span class="error"></span></div>
      <div class="form-field" data-field="phone"><label>${escapeHtml(t('students.field.phone'))}</label>
        <input class="field" name="phone" value="${escapeHtml(student.phone || '')}" maxlength="25">
        <span class="error"></span></div>
      <div class="form-field" data-field="status"><label>${escapeHtml(t('students.field.status'))}</label>
        <select class="field" name="status">${['active', 'suspended', 'graduated', 'withdrawn'].map(status => `<option value="${status}" ${student.status === status ? 'selected' : ''}>${escapeHtml(t(`students.status.${status}`))}</option>`).join('')}</select>
        <span class="error"></span></div>
    `;
    const submit = el('button', { class: 'btn btn-primary', type: 'button', text: id ? t('common.save') : t('students.add') });
    const ref = modal({
      title: id ? t('students.edit') : t('students.new'),
      subtitle: id ? student.name : t('students.subtitle'),
      body: form, size: 'wide',
      footer: [el('button', { class: 'btn', type: 'button', text: t('common.cancel'), 'data-close-modal': '' }), submit]
    });
    submit.addEventListener('click', async () => {
      A.busy(submit, true);
      const data = A.formData(form);
      try {
        if (id) await api.put(`/api/students/${encodeURIComponent(id)}`, data);
        else await api.post('/api/students', data);
        toast(id ? t('students.updated') : t('students.created'), { type: 'success' });
        ref.close();
        if (window.location.hash.startsWith('#/students')) window.location.reload();
      } catch (error) {
        if (error.fields) A.fieldErrors(form, error.fields);
        toast(error.message, { type: 'error' });
      } finally { A.busy(submit, false); }
    });
  }

  async function studentProfile(id) {
    const container = el('div', { html: `<div class="loading-panel"><span class="spinner"></span>${escapeHtml(t('common.loading'))}</div>` });
    const ref = modal({ title: t('students.profile'), body: container, size: 'xwide' });
    try {
      const [profile, history] = await Promise.all([
        api.get(`/api/students/${encodeURIComponent(id)}`),
        api.get(`/api/students/${encodeURIComponent(id)}/attendance?limit=100`)
      ]);
      const student = profile.item;
      const summary = history.summary;
      container.innerHTML = `
        <div class="flex items-center gap-12" style="margin-bottom:18px;flex-wrap:wrap">
          <span class="avatar" style="width:52px;height:52px;border-radius:14px;font-size:16px;background:var(--blue-soft);color:var(--blue);border:0">${escapeHtml(initials(student.name))}</span>
          <div class="grow" style="min-width:180px">
            <h3 style="font-size:17px">${escapeHtml(student.name)}</h3>
            <p class="text-muted" style="font-size:12px">${escapeHtml(student.id)} · ${escapeHtml(student.course || '—')} · ${escapeHtml(student.level || '—')}</p>
          </div>
          <div class="chip-row">
            <button class="btn btn-sm" id="pf-qr">${icon('qr')}<span>${escapeHtml(t('students.qrCard'))}</span></button>
            ${window.Can('reports.export') ? `<button class="btn btn-sm" id="pf-pdf">${icon('download')}<span>${escapeHtml(t('reports.studentPdf'))}</span></button>` : ''}
          </div>
        </div>
        <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
          <div class="stat" style="--accent:#258269;padding:12px"><div class="stat-label">${escapeHtml(t('common.present'))}</div><div class="stat-value" style="font-size:22px">${formatNumber(summary.present)}</div></div>
          <div class="stat" style="--accent:#B8860B;padding:12px"><div class="stat-label">${escapeHtml(t('common.late'))}</div><div class="stat-value" style="font-size:22px">${formatNumber(summary.late)}</div></div>
          <div class="stat" style="--accent:#B84545;padding:12px"><div class="stat-label">${escapeHtml(t('common.absent'))}</div><div class="stat-value" style="font-size:22px">${formatNumber(summary.absent)}</div></div>
          <div class="stat" style="--accent:#315B83;padding:12px"><div class="stat-label">${escapeHtml(t('common.attendanceRate'))}</div><div class="stat-value" style="font-size:22px">${summary.attendanceRate === null ? '—' : formatPercent(summary.attendanceRate)}</div></div>
        </div>
        <div class="info-grid" style="margin-bottom:16px">
          <div class="info-item"><div class="label">${escapeHtml(t('common.email'))}</div><div class="value">${escapeHtml(student.email || '—')}</div></div>
          <div class="info-item"><div class="label">${escapeHtml(t('common.phone'))}</div><div class="value">${escapeHtml(student.phone || '—')}</div></div>
          <div class="info-item"><div class="label">${escapeHtml(t('common.status'))}</div><div class="value">${escapeHtml(t(`students.status.${student.status}`))}</div></div>
          <div class="info-item"><div class="label">${escapeHtml(t('students.enrollments'))}</div><div class="value">${history.courses.map(c => escapeHtml(c.code)).join(', ') || '—'}</div></div>
        </div>
        <h4 style="font-size:13px;margin-bottom:8px">${escapeHtml(t('students.attendanceHistory'))}</h4>
        ${history.history.length ? `<div class="table-wrap" style="max-height:320px;overflow:auto"><table class="data">
          <thead><tr><th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.lectures'))}</th><th>${escapeHtml(t('common.course'))}</th><th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('common.recordedBy'))}</th></tr></thead>
          <tbody>${history.history.map(row => `<tr>
            <td class="mono">${formatDate(row.lectureDate)}</td><td>${escapeHtml(row.lectureTitle)}</td>
            <td>${escapeHtml(row.course || '')}</td><td>${statusBadge(row.status)}</td>
            <td class="text-muted">${escapeHtml(row.markedBy || '—')}<span class="sub">${formatDate(row.markedAt, { withTime: true })}</span></td>
          </tr>`).join('')}</tbody></table></div>`
          : emptyState({ title: t('dash.noActivity'), desc: t('empty.desc'), iconName: 'clock' })}
      `;
      $('#pf-qr', container).addEventListener('click', () => { ref.close(); qrCardModal(student.id); });
      const pdf = $('#pf-pdf', container);
      if (pdf) pdf.addEventListener('click', () => {
        api.download(`/api/reports/student/${encodeURIComponent(student.id)}/pdf?lang=${i18n.lang}`, `student-${student.id}.pdf`)
          .catch(error => toast(error.message, { type: 'error' }));
      });
    } catch (error) {
      container.innerHTML = errorState(error.message);
    }
  }

  // ============================================================ QR
  let qrState = { search: '', course: '', level: '' };

  Views.qr = async function qrView(target, params) {
    if (!window.Can('qr.view')) return Views.accessDenied(target);
    target.replaceChildren(pageHead({
      eyebrow: t('nav.qr'), title: t('qr.title'), subtitle: t('qr.subtitle'),
      actions: [
        button(t('qr.print'), { iconName: 'print', onClick: () => window.print() }),
        button(t('qr.downloadAll'), { variant: 'btn-primary', iconName: 'download', onClick: () => {
          api.download(`/api/students/qr-cards/pdf?lang=${i18n.lang}`, `qr-cards-${todayIso()}.pdf`)
            .catch(error => toast(error.message, { type: 'error' }));
        } })
      ]
    }));
    const info = el('div', { class: 'card', style: 'margin-bottom:18px' });
    info.innerHTML = `<div class="card-body" style="display:flex;gap:10px;align-items:flex-start;color:var(--muted);font-size:12.5px">
      ${icon('shield')}<span>${escapeHtml(t('qr.secureNote'))}</span></div>`;
    target.appendChild(info);

    const panel = el('section', { class: 'card' });
    panel.innerHTML = `
      <div class="table-toolbar" style="border-bottom:0">
        <label class="field-icon search-field">${icon('search')}
          <input class="field" id="qr-search" type="search" placeholder="${escapeHtml(t('common.searchPlaceholder'))}" style="width:100%"></label>
        <select class="field" id="qr-course"><option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.course'))}</option></select>
        <select class="field" id="qr-level"><option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.level'))}</option></select>
        <button class="btn btn-sm" id="qr-refresh">${icon('refresh')}<span>${escapeHtml(t('common.reset'))}</span></button>
      </div>
      <div class="card-body" id="qr-body">${skeletonRows(6)}</div>`;
    target.appendChild(panel);
    const body = $('#qr-body', panel);

    async function load() {
      try {
        const query = new URLSearchParams(qrState);
        const data = await api.get(`/api/students/qr-cards?${query}`);
        const options = await api.get('/api/students/options').catch(() => ({ courses: [], levels: [] }));
        const courseSelect = $('#qr-course', panel);
        courseSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.course'))}</option>` +
          options.courses.map(c => `<option value="${escapeHtml(c)}" ${c === qrState.course ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
        const levelSelect = $('#qr-level', panel);
        levelSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.level'))}</option>` +
          options.levels.map(l => `<option value="${escapeHtml(l)}" ${l === qrState.level ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');
        renderCards(data.items);
      } catch (error) {
        body.innerHTML = errorState(error.message);
      }
    }

    function renderCards(items) {
      if (!items.length) {
        body.innerHTML = emptyState({ title: t('empty.search'), desc: t('empty.searchDesc'), iconName: 'qr' });
        return;
      }
      const grid = el('div', { class: 'qr-grid' });
      items.forEach(item => {
        const node = el('article', { class: 'qr-card' + (item.qr ? '' : ' qr-revoked') });
        node.innerHTML = `
          <div class="qr-card-head"><b>IUA</b><small>${escapeHtml(i18n.lang === 'ar' ? 'بطاقة الحضور' : 'ATTENDANCE CARD')}</small></div>
          <div class="qr-card-body">
            <div class="qr-img" data-qr-slot></div>
            <h4>${escapeHtml(item.name)}</h4>
            <div class="sid mono">${escapeHtml(item.id)}</div>
            <div class="course">${escapeHtml(item.course || '')}</div>
          </div>
          <div class="qr-card-foot">
            <button type="button" data-act="png">${icon('download')}<span>${escapeHtml(t('qr.download'))}</span></button>
            <button type="button" data-act="card">${icon('file')}<span>${escapeHtml(t('qr.card'))}</span></button>
            ${window.Can('qr.manage') ? `<button type="button" data-act="rotate" aria-label="${escapeHtml(t('qr.rotate'))}" title="${escapeHtml(t('qr.rotate'))}">${icon('refresh')}</button>
            <button type="button" data-act="revoke" aria-label="${escapeHtml(t('qr.revoke'))}" title="${escapeHtml(t('qr.revoke'))}">${icon('x')}</button>` : ''}
          </div>`;
        const slot = $('[data-qr-slot]', node);
        if (item.qr) {
          // QR images are rendered by the server so the token never has to be
          // embedded in the page markup by a third-party client library.
          slot.innerHTML = `<img alt="${escapeHtml(item.name)} QR" width="148" height="148" style="width:148px;height:148px"
            src="/api/students/${encodeURIComponent(item.id)}/qr.png" loading="lazy">`;
        } else {
          slot.innerHTML = `<span style="color:var(--red);font-size:11px;padding:20px;display:block">${escapeHtml(t('qr.revokedLabel'))}</span>`;
          slot.style.display = 'grid';
          slot.style.placeItems = 'center';
        }
        $('[data-act=png]', node)?.addEventListener('click', () => downloadCardPng(node, item));
        $('[data-act=card]', node)?.addEventListener('click', () => {
          api.download(`/api/students/${encodeURIComponent(item.id)}/qr/card.pdf?lang=${i18n.lang}`, `qr-card-${item.id}.pdf`)
            .catch(error => toast(error.message, { type: 'error' }));
        });
        const rotate = $('[data-act=rotate]', node);
        if (rotate) rotate.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: t('qr.rotateTitle'), text: t('qr.rotateText', { name: item.name }), confirmLabel: t('qr.rotate'), danger: false });
          if (!ok) return;
          try {
            await api.post(`/api/students/${encodeURIComponent(item.id)}/qr/rotate`, {});
            toast(t('qr.rotated'), { type: 'success' });
            load();
          } catch (error) { toast(error.message, { type: 'error' }); }
        });
        const revoke = $('[data-act=revoke]', node);
        if (revoke) revoke.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: t('qr.revokeTitle'), text: t('qr.revokeText', { name: item.name }), confirmLabel: t('qr.revoke') });
          if (!ok) return;
          try {
            await api.post(`/api/students/${encodeURIComponent(item.id)}/qr/revoke`, {});
            toast(t('qr.revokedToast'), { type: 'success' });
            load();
          } catch (error) { toast(error.message, { type: 'error' }); }
        });
        grid.appendChild(node);
      });
      body.replaceChildren(grid);
    }

    function downloadCardPng(node, item) {
      if (!item.qr) return toast(t('qr.revokedLabel'), { type: 'warn' });
      api.download(`/api/students/${encodeURIComponent(item.id)}/qr.png`, `qr-${item.id}.png`)
        .catch(error => toast(error.message, { type: 'error' }));
    }

    $('#qr-search', panel).addEventListener('input', A.debounce(event => {
      qrState.search = event.target.value.trim();
      load();
    }, 320));
    $('#qr-course', panel).addEventListener('change', event => { qrState.course = event.target.value; load(); });
    $('#qr-level', panel).addEventListener('change', event => { qrState.level = event.target.value; load(); });
    $('#qr-refresh', panel).addEventListener('click', () => {
      qrState = { search: '', course: '', level: '' };
      $('#qr-search', panel).value = '';
      load();
    });
    load();
    if (params.get('student')) qrCardModal(params.get('student'));
  };

  async function qrCardModal(studentId) {
    const body = el('div', { html: `<div class="loading-panel"><span class="spinner"></span></div>` });
    const ref = modal({ title: t('students.qrCard'), body, size: '' });
    try {
      const data = await api.get(`/api/students/${encodeURIComponent(studentId)}/qr`);
      const item = data.item;
      body.innerHTML = `
        <div style="text-align:center">
          <div id="modal-qr" style="width:220px;height:220px;margin:0 auto 14px;padding:10px;border:1px solid var(--line);border-radius:12px;display:grid;place-items:center"></div>
          <h3 style="font-size:16px">${escapeHtml(item.name)}</h3>
          <p class="text-muted" style="font-size:12px">${escapeHtml(item.id)} · ${escapeHtml(item.course || '')}</p>
          ${item.qr ? '' : `<p style="color:var(--red);font-size:12px;margin-top:8px">${escapeHtml(t('qr.revokedLabel'))}</p>`}
        </div>`;
      if (item.qr) {
        $('#modal-qr', body).innerHTML = `<img alt="${escapeHtml(item.name)} QR" width="200" height="200"
          src="/api/students/${encodeURIComponent(item.id)}/qr.png" style="width:200px;height:200px">`;
      }
      ref.footer.replaceChildren(
        el('button', { class: 'btn', type: 'button', text: t('common.close'), 'data-close-modal': '' }),
        item.qr ? el('button', {
          class: 'btn btn-primary', type: 'button', text: t('common.download'),
          onclick: () => api.download(`/api/students/${encodeURIComponent(item.id)}/qr.png`, `qr-${item.id}.png`).catch(error => toast(error.message, { type: 'error' }))
        }) : el('span')
      );
    } catch (error) {
      body.innerHTML = errorState(error.message);
    }
    return ref;
  }
  Views.qrCardModal = qrCardModal;

  Views.accessDenied = function accessDenied(target) {
    target.replaceChildren(el('div', { class: 'card', html: `<div class="card-body">${emptyState({
      title: t('accessDenied'), desc: t('accessDeniedDesc'), iconName: 'shield'
    })}</div>` }));
  };

  Views.notFound = function notFound(target) {
    target.replaceChildren(el('div', { class: 'card', html: `<div class="card-body">${emptyState({
      title: t('notFound'), desc: t('notFoundDesc'), iconName: 'alert'
    })}</div>` }));
  };

  window.Views = Object.assign(window.Views || {}, Views);
  window.ViewHelpers = { pageHead, button, card, sourceLabel, trendPill, studentForm, studentProfile };
})();
