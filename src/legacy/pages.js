
'use strict';

window.ExGudangPages = (() => {
  const API = window.ExGudangAPI;
  const content = () => document.getElementById('page-content');

  let selectedItemId = null;
  let activeCategory = '';
  let activeStockFilter = 'all'; // [ADDED] Filter status stok pada halaman Barang.
  let activeReport = 'summary';
  let itemSearch = '';
  let cachedItems = [];
  let cachedCategories = [];
  let cachedDashboard = null;
  // [ADDED] State tab dan cache grafik beranda.
  let homeTab = 'summary';
  let homePeriod = 7;
  let homeCache = null;
  let homeTrendCache = {};
  let homeTrendErrors = {};


  // [ADDED] Escape teks agar data barang tidak dianggap sebagai HTML.
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  // [ADDED] Format mata uang Indonesia.
  function money(value) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function number(value) {
    return new Intl.NumberFormat('id-ID', {
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  function formatDate(value) {
    if (!value) return '-';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '-';

    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function today() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  function showLoading() {
    content().innerHTML = `
      <section class="loading-state">
        <div class="loading-spinner"></div>
        <p>Memuat data...</p>
      </section>
    `;
  }

  function showError(error) {
    content().innerHTML = `
      <section class="empty-state card">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <strong>Data gagal dimuat</strong>
        <p>${escapeHtml(error.message || 'Terjadi kesalahan')}</p>
        <button class="button" type="button" data-action="reload">
          <i class="fa-solid fa-rotate-right"></i> Coba Lagi
        </button>
      </section>
    `;
  }

  function emptyState(message, icon = 'fa-box-open') {
    return `
      <div class="empty-state">
        <i class="fa-solid ${icon}"></i>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  function statusFor(item) {
    if (Number(item.current_stock) <= 0) {
      return '<span class="status-badge danger">Habis</span>';
    }

    if (Number(item.current_stock) <= Number(item.minimum_stock)) {
      return '<span class="status-badge warning">Menipis</span>';
    }

    return '<span class="status-badge">Aman</span>';
  }

  function itemImage(item) {
    if (item.image_path) {
      return `
        <div class="item-thumb">
          <img src="${escapeHtml(item.image_path)}"
               alt="${escapeHtml(item.name)}"
               loading="lazy"
               onerror="this.parentElement.innerHTML='<i class=&quot;fa-solid fa-box&quot;></i>'">
        </div>
      `;
    }

    return `
      <div class="item-thumb">
        <i class="fa-solid fa-box"></i>
      </div>
    `;
  }

  function itemRow(item) {
    return `
      <button type="button"
              class="item-row"
              data-action="detail"
              data-id="${Number(item.id)}"
              style="width:100%;text-align:left;color:inherit;cursor:pointer">
        ${itemImage(item)}

        <div class="item-info">
          <p class="item-name">${escapeHtml(item.name)}</p>
          <p class="item-code">${escapeHtml(item.code)}</p>
          <p class="item-stock">
            Stok: ${number(item.current_stock)} ${escapeHtml(item.unit)}
          </p>
          <p class="item-price">
            Modal: ${money(item.cost_price)} · Keluar: ${money(item.outgoing_price)}
          </p>
        </div>

        <div class="item-side">
          ${statusFor(item)}
          <i class="fa-solid fa-chevron-right text-muted" style="font-size:10px"></i>
        </div>
      </button>
    `;
  }

  function movementRow(movement) {
    const isIn = movement.movement_type === 'IN';
    const isOut = movement.movement_type === 'OUT';
    const label = isIn ? 'Masuk' : isOut ? 'Keluar' : 'Penyesuaian';
    const icon = isIn ? 'fa-arrow-down' : isOut ? 'fa-arrow-up' : 'fa-arrows-rotate';
    const color = isIn ? 'text-green' : isOut ? 'text-red' : 'text-muted';
    const sign = isIn ? '+' : isOut ? '-' : '';

    return `
      <div class="movement-row">
        <div class="movement-icon ${isIn ? 'in' : isOut ? 'out' : ''}">
          <i class="fa-solid ${icon}"></i>
        </div>

        <div class="movement-info">
          <strong>${label} · ${escapeHtml(movement.item_name || '')}</strong>
          <span>${formatDate(movement.occurred_at)}</span>
          <span>${escapeHtml(movement.note || '')}</span>
        </div>

        <div class="movement-quantity ${color}">
          ${sign}${number(movement.quantity)} ${escapeHtml(movement.unit || '')}
        </div>
      </div>
    `;
  }

  function heroCard(total) {
    return `
      <section class="hero-card">
        <div>
          <p class="card-title">Total Barang</p>
          <p class="card-value">${number(total)}</p>
        </div>
        <i class="fa-solid fa-box hero-icon"></i>
      </section>
    `;
  }

  function statCard(icon, label, value, style, subtitle = '') {
    return `
      <div class="stat-card stat-${style}">
        <div class="stat-icon"><i class="fa-solid ${icon}"></i></div>
        <div class="stat-content">
          <p class="stat-label">${escapeHtml(label)}</p>
          <p class="stat-number">${escapeHtml(value)}</p>
          ${subtitle ? `<p class="card-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        </div>
      </div>
    `;
  }

  // Helper laporan: bulan, agregasi harian, grafik SVG.
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (str, n) => { const d = new Date(str + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const shortDate = (str) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(str + 'T12:00:00'));
  const presetRange = (p) => { const t = today(); return p === 'today' ? [t, t] : p === 'yesterday' ? [addDays(t, -1), addDays(t, -1)] : p === 'week' ? [addDays(t, -6), t] : [t.slice(0, 8) + '01', t]; };
  let range = { preset: 'month', start: presetRange('month')[0], end: presetRange('month')[1] };
  let activeView = { page: 'home', params: {} }, prevView = { page: 'home', params: {} }, moveType = 'all';
  const rerender = () => render(activeView.page, activeView.params);
  const toastMsg = (message, type) => window.dispatchEvent(new CustomEvent('exgudang:toast', { detail: { message, type } }));

  const rangeLabel = () => range.start === range.end ? shortDate(range.start) : `${shortDate(range.start)} – ${shortDate(range.end)}`;
  function rangeFilter() {
    const chips = [['today', 'Hari Ini'], ['yesterday', 'Kemarin'], ['week', '7 Hari'], ['month', 'Bulan Ini'], ['custom', 'Pilih Tanggal']];
    return `<section class="range-filter">
      <div class="chip-scroll">${chips.map(([k, l]) => `<button type="button" class="filter-chip ${range.preset === k ? 'active' : ''}" data-action="range-preset" data-preset="${k}">${l}</button>`).join('')}</div>
      ${range.preset === 'custom' ? `<div class="range-custom">
        <label>Dari<input class="input" type="date" id="range-start" value="${range.start}" max="${today()}"></label>
        <label>Sampai<input class="input" type="date" id="range-end" value="${range.end}" max="${today()}"></label>
        <button type="button" class="button" data-action="apply-range">Terapkan</button></div>` : ''}
      <p class="range-label"><i class="fa-regular fa-calendar"></i> ${rangeLabel()}</p></section>`;
  }
  function setPreset(p) { if (p !== 'custom') { [range.start, range.end] = presetRange(p); } range.preset = p; return rerender(); }
  function applyRange() {
    let a = document.getElementById('range-start').value, b = document.getElementById('range-end').value;
    if (!a || !b) return toastMsg('Pilih tanggal awal dan akhir.', 'error');
    if (a > b) [a, b] = [b, a];
    range = { preset: 'custom', start: a, end: b };
    return rerender();
  }

  async function rangeMovements() {
    const all = (await API.getRecentMovements(100)).data || [];
    const day = (m) => iso(new Date(m.occurred_at));
    const list = all.filter((m) => day(m) >= range.start && day(m) <= range.end);
    const oldest = all.map(day).sort()[0];
    return { list, truncated: all.length >= 100 && oldest > range.start };
  }
  const truncNote = (mv) => mv.truncated ? '<p class="range-note"><i class="fa-solid fa-circle-info"></i> Daftar dibatasi 100 transaksi terbaru, transaksi lama pada rentang ini mungkin tidak tampil. Total pada kartu tetap lengkap.</p>' : '';
  const mValue = (m) => Number(m.total_value ?? Number(m.quantity) * Number(m.unit_outgoing_price ?? m.unit_cost ?? 0));
  function buckets(list) {
    const days = Math.round((new Date(range.end) - new Date(range.start)) / 864e5) + 1;
    const n = days === 1 ? 24 : Math.min(days, 92);
    const d = Array.from({ length: n }, () => ({ in: 0, out: 0, val: 0 }));
    list.forEach((m) => {
      const i = days === 1 ? new Date(m.occurred_at).getHours() : Math.round((new Date(iso(new Date(m.occurred_at))) - new Date(range.start)) / 864e5);
      if (!d[i]) return;
      if (m.movement_type === 'IN') d[i].in += Number(m.quantity);
      if (m.movement_type === 'OUT') { d[i].out += Number(m.quantity); d[i].val += mValue(m); }
    });
    return d;
  }
  const chartAxis = () => `<div class="chart-axis"><span>${range.start === range.end ? '00:00' : shortDate(range.start)}</span><span>${range.start === range.end ? '23:59' : shortDate(range.end)}</span></div>`;
  function barChart(d) {
    const max = Math.max(1, ...d.map((x) => Math.max(x.in, x.out))), w = 300 / d.length;
    return `<svg viewBox="0 0 300 112" class="chart-svg">${d.map((x, i) => `<rect x="${i * w + 0.5}" y="${100 - 90 * x.in / max}" width="${w / 2 - 0.5}" height="${90 * x.in / max}" fill="#07864f"/><rect x="${i * w + w / 2}" y="${100 - 90 * x.out / max}" width="${w / 2 - 0.5}" height="${90 * x.out / max}" fill="#e62e43"/>`).join('')}<line x1="0" x2="300" y1="100" y2="100" stroke="#e9edf0"/></svg>`;
  }
  function lineChart(d) {
    let c = 0; const pts = d.map((x) => (c += x.val)); const max = Math.max(1, c), w = 300 / (d.length - 1 || 1);
    const p = pts.map((v, i) => `${i * w},${100 - 90 * v / max}`).join(' ');
    return `<svg viewBox="0 0 300 104" class="chart-svg"><polygon points="0,100 ${p} 300,100" fill="#e8f7ef"/><polyline points="${p}" fill="none" stroke="#07864f" stroke-width="1.8"/><line x1="0" x2="300" y1="100" y2="100" stroke="#e9edf0"/></svg>`;
  }
  


  // [ADDED] Mengambil agregasi transaksi lengkap per rentang agar grafik tidak bergantung pada 100 transaksi terbaru.
  async function fetchHomeTrend(period) {
    const endDate = today();
    const startDate = addDays(endDate, -(period - 1));
    const bucketSize = period === 7 ? 1 : period === 30 ? 5 : 7;
    const ranges = [];

    for (let offset = 0; offset < period; offset += bucketSize) {
      const from = addDays(startDate, offset);
      const to = addDays(startDate, Math.min(period - 1, offset + bucketSize - 1));
      ranges.push({ from, to });
    }

    const reports = await Promise.all(ranges.map(async (dateRange) => {
      const response = await API.getMovementReport(dateRange.from, dateRange.to);
      const data = response.data || {};
      const date = new Date(dateRange.from + 'T12:00:00');
      const label = period === 7
        ? new Intl.DateTimeFormat('id-ID', { weekday: 'short' }).format(date)
        : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(date);

      return {
        label,
        inQty: Number(data.total_in_quantity || 0),
        outQty: Number(data.total_out_quantity || 0),
        inValue: Number(data.total_in_cost_value || 0),
        outValue: Number(data.total_out_cost_value || 0)
      };
    }));

    return reports;
  }

  // [ADDED] Memuat grafik sesuai periode yang dipilih.
  async function ensureHomeTrend(period) {
    if (Object.prototype.hasOwnProperty.call(homeTrendCache, period)) return;

    try {
      homeTrendCache[period] = await fetchHomeTrend(period);
      delete homeTrendErrors[period];
    } catch (error) {
      homeTrendCache[period] = null;
      homeTrendErrors[period] = error.message || 'Grafik gagal dimuat.';
    }
  }

  // [ADDED] Grafik garis SVG dengan dua seri dan tooltip pada setiap titik.
  function homeLineChart(points, firstKey, secondKey, firstLabel, secondLabel, formatter, ariaLabel) {
    if (!points || !points.length) {
      return emptyState('Belum ada data transaksi pada periode ini', 'fa-chart-line');
    }

    const width = 320;
    const left = 8;
    const right = 312;
    const top = 12;
    const bottom = 104;
    const max = Math.max(1, ...points.map((point) => Math.max(point[firstKey], point[secondKey])));
    const x = (index) => points.length === 1 ? (left + right) / 2 : left + index * (right - left) / (points.length - 1);
    const y = (value) => bottom - (Number(value || 0) / max) * (bottom - top);
    const series = [
      { key: firstKey, label: firstLabel, color: 'var(--green)' },
      { key: secondKey, label: secondLabel, color: 'var(--red)' }
    ];

    const grid = [0, 0.5, 1].map((ratio) => {
      const position = bottom - ratio * (bottom - top);
      return '<line x1="' + left + '" x2="' + right + '" y1="' + position + '" y2="' + position + '" stroke="var(--border)" stroke-dasharray="3 4"/>';
    }).join('');

    const lines = series.map((item) => {
      const coordinates = points.map((point, index) => x(index) + ',' + y(point[item.key])).join(' ');
      const markers = points.map((point, index) => {
        const title = escapeHtml(point.label + ' · ' + item.label + ': ' + formatter(point[item.key]));
        return '<circle cx="' + x(index) + '" cy="' + y(point[item.key]) + '" r="3" fill="' + item.color + '" stroke="var(--surface)" stroke-width="1.5"><title>' + title + '</title></circle>';
      }).join('');

      return '<polyline points="' + coordinates + '" fill="none" stroke="' + item.color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' + markers;
    }).join('');

    const middle = points[Math.floor((points.length - 1) / 2)];
    const axis = '<div class="chart-axis"><span>' + escapeHtml(points[0].label) + '</span><span>' + escapeHtml(middle.label) + '</span><span>' + escapeHtml(points[points.length - 1].label) + '</span></div>';

    return '<svg viewBox="0 0 ' + width + ' 116" class="chart-svg" role="img" aria-label="' + escapeHtml(ariaLabel) + '">' + grid + lines + '</svg>' + axis;
  }

  // [ADDED] Komposisi persediaan dihitung dari status setiap barang aktual.
  function homeCompositionMarkup(items) {
    const counts = { safe: 0, low: 0, empty: 0 };
    items.forEach((item) => {
      if (Number(item.current_stock) <= 0) counts.empty += 1;
      else if (Number(item.current_stock) <= Number(item.minimum_stock)) counts.low += 1;
      else counts.safe += 1;
    });

    const total = items.length;
    const safePercent = total ? counts.safe / total * 100 : 0;
    const lowPercent = total ? counts.low / total * 100 : 0;
    const emptyPercent = total ? counts.empty / total * 100 : 0;
    const lowEnd = safePercent + lowPercent;
    const background = total
      ? 'conic-gradient(var(--green) 0% ' + safePercent + '%, var(--orange) ' + safePercent + '% ' + lowEnd + '%, var(--red) ' + lowEnd + '% 100%)'
      : 'var(--border)';

    const legendRow = (label, count, percent, color) => '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;padding:5px 0"><span style="display:flex;align-items:center;gap:7px;color:var(--muted)"><i style="width:9px;height:9px;border-radius:50%;background:' + color + ';display:inline-block"></i>' + label + '</span><b style="color:var(--text)">' + number(count) + ' <small style="font-weight:500;color:var(--muted)">(' + (total ? number(percent) : '0') + '%)</small></b></div>';

    return '<section class="card mt-12"><div class="section-heading" style="margin:0 0 12px"><h3>Komposisi Persediaan</h3><span class="text-muted" style="font-size:11px">' + number(total) + ' barang</span></div>' +
      '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">' +
        '<div role="img" aria-label="Komposisi stok: ' + counts.safe + ' aman, ' + counts.low + ' menipis, ' + counts.empty + ' habis" style="width:132px;height:132px;flex:0 0 132px;border-radius:50%;background:' + background + ';display:grid;place-items:center">' +
          '<div style="width:88px;height:88px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center"><strong style="font-size:22px;line-height:1.1">' + number(total) + '</strong><span style="font-size:10px;color:var(--muted)">Total barang</span></div>' +
        '</div>' +
        '<div style="flex:1;min-width:130px">' +
          legendRow('Aman', counts.safe, safePercent, 'var(--green)') +
          legendRow('Menipis', counts.low, lowPercent, 'var(--orange)') +
          legendRow('Habis', counts.empty, emptyPercent, 'var(--red)') +
        '</div>' +
      '</div></section>';
  }

  // [ADDED] Tab beranda tidak mengubah navigasi global aplikasi.
  function homeTabsMarkup() {
    const tabs = [
      ['summary', 'Ringkasan'],
      ['transactions', 'Transaksi'],
      ['attention', 'Perlu Perhatian']
    ];

    return '<div class="chip-scroll mt-12" role="group" aria-label="Bagian beranda" style="display:flex;width:100%;padding:5px;background:var(--surface);border-radius:14px;box-shadow:var(--shadow-in);gap:5px">' +
      tabs.map(([key, label]) => '<button type="button" class="filter-chip ' + (homeTab === key ? 'active' : '') + '" data-action="home-tab" data-tab="' + key + '" aria-pressed="' + (homeTab === key ? 'true' : 'false') + '" style="flex:1;min-width:0;padding:9px 7px;font-size:11px;white-space:nowrap">' + label + '</button>').join('') +
      '</div>';
  }

  // [ADDED] Render isi tab berdasarkan data dashboard dan API laporan.
  function renderHomeView() {
    if (!homeCache) return;

    const d = homeCache.dashboard;
    const summary = d.summary || {};
    const stock = summary.stock || {};
    const monthly = summary.monthly || {};
    const daily = summary.daily || summary.today || monthly;
    const alerts = d.stock_alerts || [];
    const movements = d.recent_movements || [];
    const items = homeCache.items || [];
    const user = (API.getAdmin() || {}).username;
    const alertRow = (item) => '<button type="button" class="item-row" data-action="detail" data-id="' + Number(item.id) + '" style="width:100%;text-align:left;color:inherit">' +
      itemImage(item) + '<div class="item-info"><p class="item-name">' + escapeHtml(item.name) + '</p><p class="item-code">' + escapeHtml(item.code || '') + '</p>' +
      '<p class="item-stock">Stok: ' + number(item.current_stock) + ' ' + escapeHtml(item.unit) + '</p></div>' +
      '<div class="item-side">' + statusFor(item) + '<span class="min-label">Min. ' + number(item.minimum_stock) + ' ' + escapeHtml(item.unit) + '</span></div></button>';

    let body = '';

    if (homeTab === 'summary') {
      const trend = homeTrendCache[homePeriod];
      const trendError = homeTrendErrors[homePeriod];
      const points = Array.isArray(trend) ? trend : [];
      const total = (key) => points.reduce((sum, point) => sum + Number(point[key] || 0), 0);
      const periodOptions = [[7, '7 Hari'], [30, '30 Hari'], [90, '90 Hari']];

      body = '<section class="hero-pro mt-12">' +
        '<div class="hero-top"><div><p>' + (user ? 'Halo, ' + escapeHtml(user) : 'Ringkasan Gudang') + '</p><h2>Total Barang</h2></div><strong>' + number(stock.total_items) + '</strong></div>' +
        '<div class="hero-meta"><div><span>Total Stok</span><b>' + number(stock.total_stock_units ?? 0) + '</b></div>' +
        '<div><span>Nilai Persediaan</span><b>' + money(stock.total_stock_cost_value ?? 0) + '</b></div>' +
        '<div><span>Stok Habis</span><b>' + number(stock.empty_stock_items ?? 0) + '</b></div></div></section>' +

        '<div class="button-row mt-12"><button type="button" class="button" data-action="stock-in"><i class="fa-solid fa-plus"></i> Barang Masuk</button>' +
        '<button type="button" class="button button-danger" data-action="stock-out"><i class="fa-solid fa-minus"></i> Barang Keluar</button></div>' +

        '<section class="card mt-12"><div class="section-heading" style="margin:0 0 10px"><h3>Pergerakan Barang</h3><span class="legend">Jumlah unit</span></div>' +
        '<div class="chip-scroll" style="margin-bottom:10px">' + periodOptions.map(([period, label]) => '<button type="button" class="filter-chip ' + (homePeriod === period ? 'active' : '') + '" data-action="home-period" data-period="' + period + '">' + label + '</button>').join('') + '</div>' +
        (trendError ? '<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>' + escapeHtml(trendError) + '</p><button type="button" class="text-link" data-action="home-period-retry">Coba lagi</button></div>' :
          homeLineChart(points, 'inQty', 'outQty', 'Masuk', 'Keluar', number, 'Grafik garis jumlah barang masuk dan keluar')) +
        '<div class="legend" style="display:flex;justify-content:space-between;gap:12px;margin-top:8px"><span><i class="dot g"></i>Masuk <b>' + number(total('inQty')) + ' unit</b></span><span><i class="dot r"></i>Keluar <b>' + number(total('outQty')) + ' unit</b></span></div></section>' +

        '<section class="card mt-12"><div class="section-heading" style="margin:0 0 10px"><h3>Nilai Barang Masuk & Keluar</h3><span class="legend">Harga modal</span></div>' +
        (trendError ? '<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Grafik nilai belum dapat dimuat.</p></div>' :
          homeLineChart(points, 'inValue', 'outValue', 'Nilai masuk', 'Nilai keluar', money, 'Grafik garis nilai modal barang masuk dan keluar dalam rupiah')) +
        '<div class="legend" style="display:flex;justify-content:space-between;gap:12px;margin-top:8px"><span><i class="dot g"></i>Masuk <b>' + money(total('inValue')) + '</b></span><span><i class="dot r"></i>Keluar <b>' + money(total('outValue')) + '</b></span></div>' +
        '<p class="form-hint mt-12">Nilai dihitung berdasarkan harga modal, bukan harga jual.</p></section>' +

        homeCompositionMarkup(items) +
        '<div class="info-row mt-12"><div class="info-card"><span>Laba Bulan Ini</span><b class="text-green">' + money(monthly.estimated_profit) + '</b></div>' +
        '<div class="info-card"><span>Nilai Barang Keluar Bulan Ini</span><b>' + money(monthly.total_outgoing_value) + '</b></div></div>';
    } else if (homeTab === 'transactions') {
      body = '<section class="panel mt-12"><div class="panel-head"><h3>Transaksi Terbaru</h3><span class="count-badge">' + movements.length + '</span>' +
        '<button type="button" class="text-link" data-action="all-movements">Lihat Semua <i class="fa-solid fa-chevron-right"></i></button></div>' +
        '<div class="panel-body">' + (movements.length ? movements.map(movementRow).join('') : emptyState('Belum ada transaksi', 'fa-clock-rotate-left')) + '</div></section>' +
        '<div class="button-row mt-12"><button type="button" class="button" data-action="stock-in"><i class="fa-solid fa-plus"></i> Barang Masuk</button>' +
        '<button type="button" class="button button-danger" data-action="stock-out"><i class="fa-solid fa-minus"></i> Barang Keluar</button></div>';
    } else {
      body = '<section class="panel mt-12"><div class="panel-head"><h3>Stok Perlu Perhatian</h3><span class="count-badge">' + alerts.length + '</span>' +
        '<button type="button" class="text-link" data-action="low-stock">Lihat Laporan <i class="fa-solid fa-chevron-right"></i></button></div>' +
        '<div class="panel-body">' + (alerts.length ? alerts.map(alertRow).join('') : emptyState('Semua stok masih aman', 'fa-circle-check')) + '</div></section>';
    }

    content().innerHTML = homeTabsMarkup() + body;
  }

  // [ADDED] Memuat ulang grafik tanpa mengambil ulang seluruh data beranda.
  async function loadHomePeriod() {
    if (!homeCache) return renderHome();
    showLoading();
    await ensureHomeTrend(homePeriod);
    renderHomeView();
  }

  // [MODIFIED] Beranda menggunakan tab Ringkasan, Transaksi, dan Perlu Perhatian.
  async function renderHome() {
    showLoading();
    homeTrendCache = {};
    homeTrendErrors = {};

    try {
      const [dashboardResult, itemsResult] = await Promise.all([
        API.getDashboard(),
        API.getItems()
      ]);

      homeCache = {
        dashboard: dashboardResult.data || {},
        items: itemsResult.data || []
      };

      if (homeTab === 'summary') await ensureHomeTrend(homePeriod);
      renderHomeView();
    } catch (error) {
      showError(error);
    }
  }

  // [MODIFIED] Halaman Barang menjadi pusat pengelolaan persediaan.
  async function renderItems() {
    showLoading();

    try {
      const [itemsResult, categoriesResult] = await Promise.all([
        API.getItems(),
        API.getCategories()
      ]);

      cachedItems = itemsResult.data || [];
      cachedCategories = categoriesResult.data || [];

      const stockOf = (item) => Number(item.current_stock || 0);
      const minimumOf = (item) => Number(item.minimum_stock || 0);
      const counts = {
        safe: cachedItems.filter((item) => stockOf(item) > minimumOf(item)).length,
        low: cachedItems.filter((item) => stockOf(item) > 0 && stockOf(item) <= minimumOf(item)).length,
        empty: cachedItems.filter((item) => stockOf(item) <= 0).length
      };
      const totalUnits = cachedItems.reduce((sum, item) => sum + stockOf(item), 0);
      const searchTerm = itemSearch.trim().toLocaleLowerCase('id-ID');
      const visibleItems = cachedItems.filter((item) => {
        const matchesSearch = !searchTerm ||
          String(item.name || '').toLocaleLowerCase('id-ID').includes(searchTerm) ||
          String(item.code || '').toLocaleLowerCase('id-ID').includes(searchTerm);
        const matchesCategory = !activeCategory || Number(item.category_id) === Number(activeCategory);
        const stock = stockOf(item);
        const minimum = minimumOf(item);
        const matchesStock = activeStockFilter === 'all' ||
          (activeStockFilter === 'safe' && stock > minimum) ||
          (activeStockFilter === 'low' && stock > 0 && stock <= minimum) ||
          (activeStockFilter === 'empty' && stock <= 0);

        return matchesSearch && matchesCategory && matchesStock;
      });

      const stockFilters = [
        ['all', 'Semua', cachedItems.length],
        ['safe', 'Aman', counts.safe],
        ['low', 'Menipis', counts.low],
        ['empty', 'Habis', counts.empty]
      ];

      content().innerHTML = `
        <section class="items-overview" aria-label="Ringkasan persediaan">
          <div class="items-overview-main">
            <span>Jenis barang</span>
            <strong>${number(cachedItems.length)}</strong>
          </div>
          <div class="items-overview-stat">
            <span>Total unit stok</span>
            <strong>${number(totalUnits)}</strong>
          </div>
          <div class="items-overview-stat warning">
            <span>Perlu restock</span>
            <strong>${number(counts.low + counts.empty)}</strong>
          </div>
        </section>

        <div class="items-list-heading">
          <div>
            <h2>Daftar Persediaan</h2>
            <span>${number(visibleItems.length)} dari ${number(cachedItems.length)} barang</span>
          </div>
        </div>

        <label class="search-box">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="item-search" type="search"
                 placeholder="Cari nama atau kode barang..."
                 value="${escapeHtml(itemSearch)}"
                 autocomplete="off">
        </label>

        <div class="filter-tabs mt-12" role="group" aria-label="Filter status stok">
          ${stockFilters.map(([key, label, count]) => `
            <button type="button"
                    class="filter-chip ${activeStockFilter === key ? 'active' : ''}"
                    data-action="stock-filter"
                    data-filter="${key}"
                    aria-pressed="${activeStockFilter === key ? 'true' : 'false'}">
              ${label} <span class="filter-count">${number(count)}</span>
            </button>
          `).join('')}
        </div>

        <div class="filter-tabs mt-12" role="group" aria-label="Filter kategori barang">
          <button type="button"
                  class="filter-chip ${activeCategory === '' ? 'active' : ''}"
                  data-action="category-filter"
                  data-id=""
                  aria-pressed="${activeCategory === '' ? 'true' : 'false'}">Semua kategori</button>

          ${cachedCategories.map((category) => `
            <button type="button"
                    class="filter-chip ${activeCategory === String(category.id) ? 'active' : ''}"
                    data-action="category-filter"
                    data-id="${Number(category.id)}"
                    aria-pressed="${activeCategory === String(category.id) ? 'true' : 'false'}">
              ${escapeHtml(category.name)}
            </button>
          `).join('')}
        </div>

        <section class="item-list mt-16" aria-label="Daftar barang">
          ${visibleItems.length
            ? visibleItems.map(itemRow).join('')
            : `<div class="card">${emptyState(cachedItems.length ? 'Tidak ada barang yang sesuai filter' : 'Barang belum tersedia', 'fa-box-open')}</div>`}
        </section>

        <button type="button" class="fab" data-action="create-item" aria-label="Tambah barang">
          <i class="fa-solid fa-plus"></i>
        </button>
      `;
    } catch (error) {
      showError(error);
    }
  }

  // [ADDED] Simpan kata pencarian sebelum daftar barang dimuat ulang.
  function setItemSearch(value) {
    itemSearch = String(value || '');
  }

  // [ADDED] Form tambah atau edit barang.
  async function renderItemForm(id = null) {
    showLoading();

    try {
      const [categoriesResult, itemResult] = await Promise.all([
        API.getCategories(),
        id ? API.getItem(id) : Promise.resolve({ data: null })
      ]);

      cachedCategories = categoriesResult.data || [];
      const item = itemResult.data;

      selectedItemId = id;

      content().innerHTML = `
        <div class="page-heading">
          <button type="button" class="icon-button" data-action="back-items" aria-label="Kembali">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <h2>${item ? 'Edit Barang' : 'Tambah Barang'}</h2>
          <span style="width:40px"></span>
        </div>

        <form id="item-form" class="card form-stack">
          <div class="photo-box"><i class="fa-solid fa-camera"></i><span>Foto Barang (opsional)</span></div>
          <div class="form-group">
            <label>Nama Barang <span class="required">*</span></label>
            <input class="input" name="name" required maxlength="150"
                   placeholder="Contoh: Beras Premium"
                   value="${escapeHtml(item?.name || '')}">
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label>Kategori</label>
              <select class="select" name="category_id">
                <option value="">Tanpa kategori</option>
                ${cachedCategories.map((category) => `
                  <option value="${Number(category.id)}"
                    ${Number(item?.category_id) === Number(category.id) ? 'selected' : ''}>
                    ${escapeHtml(category.name)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Satuan <span class="required">*</span></label>
              <select class="select" name="unit" required>
                ${['pcs', 'kg', 'gram', 'liter', 'ml', 'botol', 'pak', 'dus', 'karung', 'ikat'].map((unit) => `
                  <option value="${unit}" ${item?.unit === unit ? 'selected' : ''}>
                    ${unit}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          ${item ? `
            <div class="form-group">
              <label>Kode Barang</label>
              <input class="input" value="${escapeHtml(item.code)}" readonly>
              <span class="form-hint">Kode barang tidak dapat diubah.</span>
            </div>
          ` : ''}

          <div class="form-grid highlight-box">
            <div class="form-group">
              <label>Harga Modal <span class="required">*</span></label>
              <div class="input-with-suffix">
                <input class="input" type="number" name="cost_price"
                       min="0" step="any" required
                       value="${item ? Number(item.cost_price) : ''}">
                <span class="input-suffix">Rp</span>
              </div>
            </div>

            <div class="form-group">
              <label>Harga Keluar <span class="required">*</span></label>
              <div class="input-with-suffix">
                <input class="input" type="number" name="outgoing_price"
                       min="0" step="any" required
                       value="${item ? Number(item.outgoing_price) : ''}">
                <span class="input-suffix">Rp</span>
              </div>
            </div>
          </div>

          ${item ? '' : `
            <div class="form-group">
              <label>Stok Awal <span class="required">*</span></label>
              <input class="input" type="number" name="initial_stock"
                     min="0" step="any" required value="0">
            </div>
          `}

          <div class="form-group">
            <label>Stok Minimum <span class="required">*</span></label>
            <input class="input" type="number" name="minimum_stock"
                   min="0" step="any" required
                   value="${item ? Number(item.minimum_stock) : '0'}">
          </div>

          <div class="form-group">
            <label>Deskripsi</label>
            <textarea class="textarea" name="description"
                      maxlength="2000"
                      placeholder="Catatan tentang barang...">${escapeHtml(item?.description || '')}</textarea>
          </div>

          <div class="button-row">
            <button type="button" class="button button-secondary" data-action="back-items">
              Batal
            </button>
            <button type="submit" class="button" id="save-item-button">
              <i class="fa-solid fa-check"></i> Simpan
            </button>
          </div>
        </form>
      `;

      document.getElementById('item-form').addEventListener('submit', saveItemForm);
    } catch (error) {
      showError(error);
    }
  }

  async function saveItemForm(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const button = document.getElementById('save-item-button');
    const data = Object.fromEntries(new FormData(form).entries());

    for (const key of [
      'cost_price',
      'outgoing_price',
      'minimum_stock',
      'initial_stock'
    ]) {
      if (data[key] !== undefined) data[key] = Number(data[key]);
    }

    data.category_id = data.category_id ? Number(data.category_id) : null;

    if (data.description !== undefined) {
      data.description = data.description.trim() || null;
    }

    if (selectedItemId) delete data.initial_stock;

    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

    try {
      if (selectedItemId) {
        await API.updateItem(selectedItemId, data);
      } else {
        await API.createItem(data);
      }

      window.dispatchEvent(new CustomEvent('exgudang:toast', {
        detail: {
          message: selectedItemId ? 'Barang berhasil diperbarui' : 'Barang berhasil ditambahkan',
          type: 'success'
        }
      }));

      window.ExGudangApp.navigate('items');
    } catch (error) {
      window.dispatchEvent(new CustomEvent('exgudang:toast', {
        detail: { message: error.message, type: 'error' }
      }));

      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-check"></i> Simpan';
    }
  }

  // [ADDED] Detail barang beserta riwayat.
  async function renderItemDetail(id) {
    showLoading();
    try {
      const [ir, mr] = await Promise.all([API.getItem(id), API.getItemMovements(id, 5, 0)]);
      const i = ir.data; selectedItemId = i.id;
      const profit = Number(i.outgoing_price) - Number(i.cost_price), pct = Number(i.cost_price) ? Math.round(profit / Number(i.cost_price) * 100) : 0;
      content().innerHTML = `
        <div class="page-heading"><button type="button" class="icon-button" data-action="back-items" aria-label="Kembali"><i class="fa-solid fa-arrow-left"></i></button>
          <h2>Detail Barang</h2><span style="width:40px"></span></div>
        <div class="product-detail-head">${itemImage(i)}<div><h2>${escapeHtml(i.name)}</h2><p>${escapeHtml(i.code)}</p>${statusFor(i)}</div></div>
        <div class="detail-grid">
          <div class="detail-value tile-green"><span>Stok Saat Ini</span><strong>${number(i.current_stock)} ${escapeHtml(i.unit)}</strong></div>
          <div class="detail-value tile-red"><span>Stok Minimum</span><strong>${number(i.minimum_stock)} ${escapeHtml(i.unit)}</strong></div>
        </div>
        <section class="card mt-12"><div class="detail-grid">
          <div class="detail-value"><span>Harga Modal</span><strong>${money(i.cost_price)}</strong></div>
          <div class="detail-value"><span>Harga Keluar</span><strong>${money(i.outgoing_price)}</strong></div></div>
          <div class="detail-value tile-green mt-12"><span>Estimasi Untung</span><strong>${money(profit)} (${pct}%)</strong></div>
          <table class="detail-table mt-12"><tbody>
            <tr><td>Kategori</td><td>${escapeHtml(i.category_name || '-')}</td></tr>
            <tr><td>Satuan</td><td>${escapeHtml(i.unit)}</td></tr>
            <tr><td>Supplier</td><td>${escapeHtml(i.supplier || '-')}</td></tr>
            <tr><td>Stok Awal</td><td>${number(i.initial_stock)} ${escapeHtml(i.unit)}</td></tr></tbody></table>
          <div class="button-row mt-12">
            <button type="button" class="button" data-action="edit-item" data-id="${Number(i.id)}"><i class="fa-solid fa-pen"></i> Edit</button>
            <button type="button" class="button button-outline-danger" data-action="deactivate-item" data-id="${Number(i.id)}"><i class="fa-regular fa-trash-can"></i> Hapus</button></div>
        </section>
        <div class="section-heading"><h3>Riwayat Transaksi</h3><button type="button" class="text-link" data-action="all-movements">Lihat Semua <i class="fa-solid fa-chevron-right"></i></button></div>
        <section class="card movement-list scroll-box">${(mr.data || []).length ? mr.data.map(movementRow).join('') : emptyState('Belum ada riwayat transaksi', 'fa-clock-rotate-left')}</section>`;
    } catch (e) { showError(e); }
  }

  // [ADDED] Form transaksi stok masuk/keluar (banyak barang sekaligus).
  async function renderStockForm(type, itemId = null) {
    showLoading();
    try {
      cachedItems = (await API.getItems()).data || [];
      const isIn = type === 'in';
      const label = isIn ? 'Masuk' : 'Keluar';
      const priceOf = (it) => Number(isIn ? it.cost_price : it.outgoing_price);
      const byId = (id) => cachedItems.find((e) => Number(e.id) === Number(id));
      const toast = (message, kind) => window.dispatchEvent(new CustomEvent('exgudang:toast', { detail: { message, type: kind } }));
      let uid = 0;

      const lineHtml = (sel) => `
        <div class="line-card" data-line="${++uid}">
          <div class="line-head"><span class="line-no"></span>
            <button type="button" class="line-remove" data-remove aria-label="Hapus baris"><i class="fa-regular fa-trash-can"></i></button></div>
          <select class="select" data-f="item">
            <option value="">Pilih barang...</option>
            ${cachedItems.map((e) => `<option value="${Number(e.id)}" ${Number(sel) === Number(e.id) ? 'selected' : ''}>${escapeHtml(e.name)} (${escapeHtml(e.code)})</option>`).join('')}
          </select>
          <div class="line-info" data-f="info">Pilih barang untuk melihat stok.</div>
          <div class="form-grid">
            <div class="form-group"><label>Jumlah</label>
              <div class="input-with-suffix"><input class="input" type="number" data-f="qty" min="0" step="any" inputmode="decimal" placeholder="0"><span class="input-suffix" data-f="unit">-</span></div></div>
            <div class="form-group"><label>Harga ${isIn ? 'Modal' : 'Keluar'}</label>
              <div class="input-with-suffix"><input class="input" type="number" data-f="price" min="0" step="any" inputmode="decimal" placeholder="0"><span class="input-suffix">Rp</span></div></div>
          </div>
          <div class="line-sub"><span>Subtotal</span><b data-f="sub">Rp 0</b></div>
        </div>`;

      content().innerHTML = `
        <div class="page-heading">
          <button type="button" class="icon-button" data-action="back-items" aria-label="Kembali"><i class="fa-solid fa-arrow-left"></i></button>
          <h2>Barang ${label}</h2><span style="width:40px"></span>
        </div>
        <form id="stock-form" class="form-stack">
          <section class="card form-stack">
            <p class="card-title"><i class="fa-regular fa-file-lines"></i> Informasi Transaksi</p>
            <div class="form-grid">
              <div class="form-group"><label>Tanggal <span class="required">*</span></label>
                <input class="input" type="date" name="date" value="${today()}" required></div>
              <div class="form-group"><label>${isIn ? 'Supplier' : 'Tujuan'}</label>
                <input class="input" name="party" maxlength="150" placeholder="${isIn ? 'Nama supplier' : 'Contoh: dapur'}"></div>
            </div>
            <div class="form-group"><label>Catatan</label>
              <textarea class="textarea" name="note" maxlength="500" placeholder="Catatan untuk semua barang (opsional)"></textarea></div>
          </section>

          <div class="section-heading"><h3>Daftar Barang</h3><span class="count-badge" id="line-count">1</span></div>
          <div id="lines" class="form-stack">${lineHtml(itemId)}</div>
          <button type="button" class="button button-secondary button-block" id="add-line"><i class="fa-solid fa-plus"></i> Tambah Barang Lain</button>

          <section class="stock-summary ${isIn ? '' : 'out'}">
            <div><span>Jumlah Barang</span><b id="sum-lines">0</b></div>
            <div><span>Total Nilai</span><b id="sum-total">Rp 0</b></div>
          </section>
          <button type="submit" class="button button-block ${isIn ? '' : 'button-danger'}" id="save-stock-button">
            <i class="fa-solid fa-floppy-disk"></i> Simpan Barang ${label}
          </button>
        </form>`;

      const wrap = document.getElementById('lines');
      const f = (line, name) => line.querySelector(`[data-f="${name}"]`);

      function updateLine(line, resetPrice) {
        const it = byId(f(line, 'item').value);
        const qty = Number(f(line, 'qty').value) || 0;
        if (resetPrice) f(line, 'price').value = it ? priceOf(it) : '';
        f(line, 'unit').textContent = it ? it.unit : '-';
        const over = !isIn && it && qty > Number(it.current_stock);
        f(line, 'info').className = 'line-info' + (over ? ' warn' : '');
        f(line, 'info').innerHTML = it
          ? `Stok tersedia: <b>${number(it.current_stock)} ${escapeHtml(it.unit)}</b>${over ? ' — jumlah melebihi stok' : ''}`
          : 'Pilih barang untuk melihat stok.';
        f(line, 'sub').textContent = money(qty * (Number(f(line, 'price').value) || 0));
      }

      function refresh() {
        const lines = [...wrap.querySelectorAll('.line-card')];
        let total = 0;
        lines.forEach((l, i) => {
          l.querySelector('.line-no').textContent = `Barang ${i + 1}`;
          l.querySelector('[data-remove]').style.visibility = lines.length > 1 ? 'visible' : 'hidden';
          total += (Number(f(l, 'qty').value) || 0) * (Number(f(l, 'price').value) || 0);
        });
        document.getElementById('line-count').textContent = lines.length;
        document.getElementById('sum-lines').textContent = lines.length;
        document.getElementById('sum-total').textContent = money(total);
      }

      const addLine = (sel) => { wrap.insertAdjacentHTML('beforeend', lineHtml(sel)); const l = wrap.lastElementChild; if (sel) updateLine(l, true); refresh(); return l; };
      wrap.querySelectorAll('.line-card').forEach((l) => updateLine(l, true));
      refresh();

      document.getElementById('add-line').addEventListener('click', () => addLine(null).scrollIntoView({ behavior: 'smooth', block: 'center' }));
      wrap.addEventListener('click', (e) => { const r = e.target.closest('[data-remove]'); if (r) { r.closest('.line-card').remove(); refresh(); } });
      wrap.addEventListener('input', (e) => { const l = e.target.closest('.line-card'); if (l) { updateLine(l, false); refresh(); } });
      wrap.addEventListener('change', (e) => { const l = e.target.closest('.line-card'); if (l && e.target.dataset.f === 'item') { updateLine(l, true); refresh(); } });

      document.getElementById('stock-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const fd = Object.fromEntries(new FormData(event.currentTarget).entries());
        const button = document.getElementById('save-stock-button');
        const lines = [...wrap.querySelectorAll('.line-card')];
        const used = {};

        for (let i = 0; i < lines.length; i++) {
          const l = lines[i], it = byId(f(l, 'item').value), qty = Number(f(l, 'qty').value), price = Number(f(l, 'price').value);
          if (!it) return toast(`Barang ${i + 1}: pilih barang terlebih dahulu.`, 'error');
          if (!(qty > 0)) return toast(`Barang ${i + 1}: jumlah harus lebih dari 0.`, 'error');
          if (!(price >= 0) || f(l, 'price').value === '') return toast(`Barang ${i + 1}: isi harga.`, 'error');
          used[it.id] = (used[it.id] || 0) + qty;
          if (!isIn && used[it.id] > Number(it.current_stock)) return toast(`Barang ${i + 1}: stok ${it.name} tidak cukup.`, 'error');
        }

        button.disabled = true;
        button.textContent = 'Menyimpan...';
        const restore = () => { button.disabled = false; button.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Simpan Barang ${label}`; };
        const party = (fd.party || '').trim() || undefined, note = (fd.note || '').trim() || undefined;
        const when = new Date(`${fd.date}T12:00:00`).toISOString();
        let done = 0;

        for (const l of lines) {
          const payload = { quantity: Number(f(l, 'qty').value), note, occurred_at: when };
          const price = Number(f(l, 'price').value);
          if (isIn) { payload.unit_cost = price; payload.supplier = party; }
          else { payload.unit_outgoing_price = price; payload.destination = party; }
          try {
            const id = f(l, 'item').value;
            await (isIn ? API.stockIn(id, payload) : API.stockOut(id, payload));
            l.remove(); done++;
          } catch (error) {
            refresh(); restore();
            return toast(`${done ? done + ' barang tersimpan. ' : ''}Gagal: ${error.message}`, 'error');
          }
        }

        toast(`${done} barang ${isIn ? 'masuk' : 'keluar'} berhasil dicatat`, 'success');
        window.ExGudangApp.navigate('home');
      });
    } catch (error) {
      showError(error);
    }
  }

  // [ADDED] Laporan ringkas.
  async function renderReports() {
    showLoading();
    try {
      const [st, rep, mv] = await Promise.all([API.getReportSummary(), API.getMovementReport(range.start, range.end), rangeMovements()]);
      const s0 = st.data, r = rep.data;
      const tile = (ic, c, l, v) => `<div class="stat-card stat-${c}"><div class="stat-icon"><i class="fa-solid ${ic}"></i></div><div class="stat-content"><p class="stat-label">${l}</p><p class="stat-number">${v}</p></div></div>`;
      const link = (a, ic, col, t, sub) => `<button type="button" class="item-row" data-action="${a}"><div class="stat-icon" style="color:var(--${col});background:var(--${col}-light)"><i class="fa-solid ${ic}"></i></div><div class="item-info"><p class="item-name">${t}</p><p class="item-price">${sub}</p></div><i class="fa-solid fa-chevron-right text-muted"></i></button>`;
      content().innerHTML = `
        <div class="page-heading"><h2>Laporan</h2></div>${rangeFilter()}
        <section class="stat-grid mt-12">
          ${tile('fa-cube', 'green', 'Total Barang', number(s0.total_items))}
          ${tile('fa-database', 'blue', 'Nilai Stok', money(s0.total_stock_cost_value))}
          ${tile('fa-arrow-trend-up', 'green', 'Total Masuk', '+ ' + number(r.total_in_quantity))}
          ${tile('fa-box-archive', 'red', 'Total Keluar', '- ' + number(r.total_out_quantity))}
        </section>
        <div class="info-row mt-12">
          <div class="info-card"><span>Nilai Barang Keluar</span><b>${money(r.total_outgoing_value)}</b></div>
          <div class="info-card"><span>Estimasi Laba</span><b class="text-green">${money(r.estimated_profit)}</b></div>
        </div>
        <div class="section-heading"><h3>Pergerakan Stok</h3><span class="legend"><i class="dot g"></i>Masuk <i class="dot r"></i>Keluar</span></div>
        <section class="card">${mv.list.length ? barChart(buckets(mv.list)) + chartAxis() : emptyState('Belum ada pergerakan pada periode ini', 'fa-chart-column')}${truncNote(mv)}</section>
        <div class="section-heading"><h3>Jenis Laporan</h3></div>
        <section class="item-list">
          ${link('all-movements', 'fa-clock-rotate-left', 'blue', 'Riwayat Transaksi', 'Semua barang masuk dan keluar')}
          ${link('report-items', 'fa-boxes-stacked', 'green', 'Laporan Barang', 'Terbanyak keluar dan stok terkini')}
          ${link('report-profit', 'fa-chart-line', 'blue', 'Laporan Keuntungan', 'Estimasi laba kotor')}
          ${link('report-stock', 'fa-triangle-exclamation', 'orange', 'Laporan Stok', 'Pantau barang menipis dan habis')}
        </section>`;
    } catch (e) { showError(e); }
  }

  async function renderReportItems() {
    showLoading();
    try {
      const [res, mv] = await Promise.all([API.getItems(), rangeMovements()]);
      const items = res.data || [], agg = {};
      mv.list.filter((m) => m.movement_type === 'OUT').forEach((m) => {
        const a = agg[m.item_id] || (agg[m.item_id] = { name: m.item_name, unit: m.unit, qty: 0, val: 0 });
        a.qty += Number(m.quantity); a.val += mValue(m);
      });
      const top = Object.values(agg).sort((x, y) => y.qty - x.qty).slice(0, 10);
      content().innerHTML = `
        <div class="page-heading"><button type="button" class="icon-button" data-action="back-reports" aria-label="Kembali"><i class="fa-solid fa-arrow-left"></i></button><h2>Laporan Barang</h2><span style="width:40px"></span></div>
        ${rangeFilter()}
        <section class="panel mt-12"><div class="panel-head"><h3>Terbanyak Keluar</h3><span class="count-badge">${top.length}</span></div>
          <div class="panel-body">${top.length ? top.map((a, i) => `<div class="rank-row"><span class="rank-no">${i + 1}</span><div class="item-info"><p class="item-name">${escapeHtml(a.name || '-')}</p><p class="item-price">${money(a.val)}</p></div><b>${number(a.qty)} ${escapeHtml(a.unit || '')}</b></div>`).join('') : emptyState('Belum ada barang keluar pada periode ini', 'fa-box-open')}</div>${truncNote(mv)}</section>
        <div class="section-heading"><h3>Stok Terkini</h3><span class="count-badge">${items.length}</span></div>
        <section class="item-list">${items.length ? items.map(itemRow).join('') : `<div class="card">${emptyState('Belum ada barang')}</div>`}</section>`;
    } catch (e) { showError(e); }
  }

  async function renderMovements() {
    showLoading();
    try {
      const mv = await rangeMovements();
      const list = mv.list.filter((m) => moveType === 'all' || m.movement_type === moveType);
      const sum = (t) => mv.list.filter((m) => m.movement_type === t).reduce((a, m) => a + mValue(m), 0);
      const groups = {};
      list.forEach((m) => { (groups[iso(new Date(m.occurred_at))] = groups[iso(new Date(m.occurred_at))] || []).push(m); });
      const dayLabel = (k) => new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(k + 'T12:00:00'));
      const tabs = [['all', 'Semua'], ['IN', 'Masuk'], ['OUT', 'Keluar']];
      content().innerHTML = `
        <div class="page-heading"><button type="button" class="icon-button" data-action="go-back" aria-label="Kembali"><i class="fa-solid fa-arrow-left"></i></button><h2>Riwayat Transaksi</h2><span style="width:40px"></span></div>
        ${rangeFilter()}
        <div class="stat-grid three mt-12">
          <div class="mini-stat blue"><span>Transaksi</span><strong>${mv.list.length}</strong><small>pada periode</small></div>
          <div class="mini-stat green"><span>Nilai Masuk</span><strong>${money(sum('IN'))}</strong></div>
          <div class="mini-stat red"><span>Nilai Keluar</span><strong>${money(sum('OUT'))}</strong></div>
        </div>
        <div class="chip-scroll mt-12">${tabs.map(([k, l]) => `<button type="button" class="filter-chip ${moveType === k ? 'active' : ''}" data-action="move-type" data-type="${k}">${l}</button>`).join('')}</div>
        ${truncNote(mv)}
        ${Object.keys(groups).sort().reverse().map((k) => `<div class="day-head"><b>${dayLabel(k)}</b><span>${groups[k].length} transaksi</span></div><section class="card movement-list">${groups[k].map(movementRow).join('')}</section>`).join('') || `<div class="card mt-12">${emptyState('Tidak ada transaksi pada periode ini', 'fa-clock-rotate-left')}</div>`}`;
    } catch (e) { showError(e); }
  }

  async function renderReportProfit() {
    showLoading();
    try {
      const [rep, mv] = await Promise.all([API.getMovementReport(range.start, range.end), rangeMovements()]);
      const data = rep.data, out = Number(data.total_outgoing_value), cost = Number(data.total_out_cost_value), pr = Number(data.estimated_profit), margin = out ? Math.round(pr / out * 100) : 0;
      content().innerHTML = `
        <div class="page-heading"><button type="button" class="icon-button" data-action="back-reports" aria-label="Kembali"><i class="fa-solid fa-arrow-left"></i></button><h2>Laporan Keuntungan</h2><span style="width:40px"></span></div>
        ${rangeFilter()}
        <div class="profit-box mt-12"><div><span>Estimasi Keuntungan</span><strong>${money(pr)}</strong></div><div><span>Margin</span><strong>${margin}%</strong></div></div>
        <section class="card mt-12"><p class="card-title">Nilai Barang Keluar (kumulatif)</p>${lineChart(buckets(mv.list))}${chartAxis()}${truncNote(mv)}</section>
        <div class="section-heading"><h3>Detail</h3></div>
        <section class="card"><table class="detail-table"><tbody>
          <tr><td>Total Nilai Keluar</td><td>${money(out)}</td></tr>
          <tr><td>Modal Barang Keluar</td><td>${money(cost)}</td></tr>
          <tr><td>Estimasi Keuntungan</td><td class="text-green">${money(pr)}</td></tr></tbody></table></section>
        <p class="form-hint mt-12">Estimasi laba kotor belum dikurangi biaya operasional.</p>`;
    } catch (e) { showError(e); }
  }

  // [ADDED] Laporan stok menipis dan habis.
  async function renderReportStock() {
    showLoading();

    try {
      const result = await API.getItems();
      const items = result.data || [];

      content().innerHTML = `
        <div class="page-heading">
          <button type="button" class="icon-button" data-action="back-reports" aria-label="Kembali">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <h2>Laporan Stok</h2>
        </div>

        <div class="filter-tabs mb-12">
          <button type="button" class="filter-chip active" data-action="stock-report-filter" data-filter="all">Semua</button>
          <button type="button" class="filter-chip" data-action="stock-report-filter" data-filter="low">Menipis</button>
          <button type="button" class="filter-chip" data-action="stock-report-filter" data-filter="empty">Habis</button>
        </div>

        <section class="item-list" id="stock-report-list">
          ${items.length
            ? items.map(itemRow).join('')
            : `<div class="card">${emptyState('Belum ada barang')}</div>`}
        </section>
      `;
    } catch (error) {
      showError(error);
    }
  }

  function filterStockReport(filter) {
    const buttons = content().querySelectorAll('[data-action="stock-report-filter"]');
    buttons.forEach((button) => {
      button.classList.toggle('active', button.dataset.filter === filter);
    });

    const items = filter === 'empty'
      ? cachedItems.filter((item) => Number(item.current_stock) === 0)
      : filter === 'low'
        ? cachedItems.filter((item) => Number(item.current_stock) <= Number(item.minimum_stock))
        : cachedItems;

    const list = document.getElementById('stock-report-list');

    if (list) {
      list.innerHTML = items.length
        ? items.map(itemRow).join('')
        : emptyState('Tidak ada barang pada filter ini');
    }
  }

  // [ADDED] Fungsi publik untuk navigasi aplikasi.
  async function render(page, params = {}) {
    if (page !== activeView.page) prevView = activeView;
    activeView = { page, params };
    switch (page) {
      case 'home':
        return renderHome();
      case 'items':
        return renderItems();
      case 'item-form':
        return renderItemForm(params.id || null);
      case 'detail':
        return renderItemDetail(params.id);
      case 'stock-in':
        return renderStockForm('in', params.id || null);
      case 'stock-out':
        return renderStockForm('out', params.id || null);
      case 'reports':
        return renderReports();
      case 'report-items':
        return renderReportItems();
      case 'report-profit':
        return renderReportProfit();
      case 'report-stock':
        return renderReportStock();
      case 'movements':
        return renderMovements();
      default:
        return renderHome();
    }
  }

  // [ADDED] Handler untuk aksi yang butuh fungsi tambahan.
  async function handleAction(action, id, element) {
    switch (action) {
      case 'reload':
        return rerender();
      // [ADDED] Interaksi tab dan periode grafik pada beranda.
      case 'home-tab':
        homeTab = ['summary', 'transactions', 'attention'].includes(element.dataset.tab) ? element.dataset.tab : 'summary';
        return renderHomeView();
      case 'home-period':
        homePeriod = [7, 30, 90].includes(Number(element.dataset.period)) ? Number(element.dataset.period) : 7;
        return loadHomePeriod();
      case 'home-period-retry':
        delete homeTrendCache[homePeriod];
        delete homeTrendErrors[homePeriod];
        return loadHomePeriod();
      case 'create-item':
        return render('item-form');
      case 'detail':
        return render('detail', { id });
      case 'edit-item':
        return render('item-form', { id });
      case 'back-items':
        return render('items');
      case 'back-reports':
        return render('reports');
      case 'category-filter':
        activeCategory = element.dataset.id || '';
        return render('items');
      case 'stock-filter': // [ADDED] Filter status stok pada halaman Barang.
        activeStockFilter = element.dataset.filter || 'all';
        return render('items');
      case 'stock-in':
        return render('stock-in', { id: id || null });
      case 'stock-out':
        return render('stock-out', { id: id || null });
      case 'low-stock':
        return render('report-stock');
      case 'all-movements':
        return render('movements');
      case 'go-back':
        return render(prevView.page, prevView.params);
      case 'range-preset':
        return setPreset(element.dataset.preset);
      case 'apply-range':
        return applyRange();
      case 'move-type':
        moveType = element.dataset.type;
        return rerender();
      case 'report-items':
        return render('report-items');
      case 'report-profit':
        return render('report-profit');
      case 'report-stock':
        return render('report-stock');
      case 'apply-profit-period':
        return rerender();
      case 'stock-report-filter':
        return filterStockReport(element.dataset.filter);
      case 'deactivate-item': {
        const accepted = await window.ExGudangApp.confirm(
          'Nonaktifkan Barang',
          'Barang ini tidak akan muncul di daftar aktif. Riwayat transaksinya tetap tersimpan.'
        );

        if (!accepted) return;

        try {
          await API.deactivateItem(id);

          window.dispatchEvent(new CustomEvent('exgudang:toast', {
            detail: { message: 'Barang berhasil dinonaktifkan', type: 'success' }
          }));

          return render('items');
        } catch (error) {
          window.dispatchEvent(new CustomEvent('exgudang:toast', {
            detail: { message: error.message, type: 'error' }
          }));
        }

        break;
      }
      default:
        break;
    }
  }

  return {
    render,
    handleAction,
    renderHome,
    renderItems,
    setItemSearch, // [ADDED] Dipakai input pencarian pada app.js.
    renderReports
  };
})();
