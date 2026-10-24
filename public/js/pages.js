
'use strict';

window.ExGudangPages = (() => {
  const API = window.ExGudangAPI;
  const content = () => document.getElementById('page-content');

  let selectedItemId = null;
  let activeCategory = '';
  let activeReport = 'summary';
  let itemSearch = '';
  let cachedItems = [];
  let cachedCategories = [];
  let cachedDashboard = null;

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
  

  // [ADDED] Beranda berdasarkan dashboard API.
  async function renderHome() {
    showLoading();
    try {
      const d = (await API.getDashboard()).data, sm = d.summary, st = sm.stock, mo = sm.monthly, day = sm.daily || sm.today || mo;
      const alerts = d.stock_alerts || [], moves = d.recent_movements || [];
      const user = (API.getAdmin() || {}).username;
      const alertRow = (i) => `<button type="button" class="item-row" data-action="detail" data-id="${Number(i.id)}" style="width:100%;text-align:left;color:inherit">
        ${itemImage(i)}<div class="item-info"><p class="item-name">${escapeHtml(i.name)}</p><p class="item-code">${escapeHtml(i.code || '')}</p>
        <p class="item-stock">Stok: ${number(i.current_stock)} ${escapeHtml(i.unit)}</p></div>
        <div class="item-side">${statusFor(i)}<span class="min-label">Min. ${number(i.minimum_stock)} ${escapeHtml(i.unit)}</span></div></button>`;
      content().innerHTML = `
        <section class="hero-pro">
          <div class="hero-top"><div><p>${user ? 'Halo, ' + escapeHtml(user) : 'Ringkasan Gudang'}</p><h2>Total Barang</h2></div><strong>${number(st.total_items)}</strong></div>
          <div class="hero-meta">
            <div><span>Total Stok</span><b>${number(st.total_stock_units ?? 0)}</b></div>
            <div><span>Nilai Stok</span><b>${money(st.total_stock_cost_value ?? 0)}</b></div>
            <div><span>Stok Habis</span><b>${number(st.empty_stock_items ?? 0)}</b></div>
          </div>
        </section>

        <div class="stat-grid three mt-12">
          <div class="mini-stat green"><span>Masuk</span><strong>+ ${number(day.total_in_quantity)}</strong><small>hari ini</small></div>
          <div class="mini-stat red"><span>Keluar</span><strong>- ${number(day.total_out_quantity)}</strong><small>hari ini</small></div>
          <div class="mini-stat orange"><span>Menipis</span><strong>${number(st.low_stock_items)}</strong><small>barang</small></div>
        </div>

        <div class="info-row mt-12">
          <div class="info-card"><span>Laba Bulan Ini</span><b class="text-green">${money(mo.estimated_profit)}</b></div>
          <div class="info-card"><span>Barang Keluar Bulan Ini</span><b>${money(mo.total_outgoing_value)}</b></div>
        </div>

        <section class="panel mt-16">
          <div class="panel-head"><h3>Stok Menipis</h3><span class="count-badge">${alerts.length}</span>
            <button type="button" class="text-link" data-action="low-stock">Lihat Semua <i class="fa-solid fa-chevron-right"></i></button></div>
          <div class="panel-body">${alerts.length ? alerts.map(alertRow).join('') : emptyState('Semua stok masih aman', 'fa-circle-check')}</div>
        </section>

        <div class="button-row mt-12">
          <button type="button" class="button" data-action="stock-in"><i class="fa-solid fa-plus"></i> Barang Masuk</button>
          <button type="button" class="button button-danger" data-action="stock-out"><i class="fa-solid fa-minus"></i> Barang Keluar</button>
        </div>

        <section class="panel mt-16">
          <div class="panel-head"><h3>Transaksi Terbaru</h3><span class="count-badge">${moves.length}</span>
            <button type="button" class="text-link" data-action="all-movements">Lihat Semua <i class="fa-solid fa-chevron-right"></i></button></div>
          <div class="panel-body">${moves.length ? moves.map(movementRow).join('') : emptyState('Belum ada transaksi', 'fa-clock-rotate-left')}</div>
        </section>`;
    } catch (e) { showError(e); }
  }

  // [ADDED] Daftar barang, pencarian dan filter.
  async function renderItems() {
    showLoading();

    try {
      const [itemsResult, categoriesResult] = await Promise.all([
        API.getItems({
          search: itemSearch,
          categoryId: activeCategory || undefined
        }),
        API.getCategories()
      ]);

      cachedItems = itemsResult.data || [];
      cachedCategories = categoriesResult.data || [];

      content().innerHTML = `
        <div class="page-heading">
          <h2>Barang</h2>
          <span class="text-muted">${cachedItems.length} barang</span>
        </div>

        <label class="search-box">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="item-search" type="search"
                 placeholder="Cari barang atau kode..."
                 value="${escapeHtml(itemSearch)}"
                 autocomplete="off">
        </label>

        <div class="filter-tabs mt-12">
          <button type="button"
                  class="filter-chip ${activeCategory === '' ? 'active' : ''}"
                  data-action="category-filter"
                  data-id="">Semua</button>

          ${cachedCategories.map((category) => `
            <button type="button"
                    class="filter-chip ${activeCategory === String(category.id) ? 'active' : ''}"
                    data-action="category-filter"
                    data-id="${Number(category.id)}">
              ${escapeHtml(category.name)}
            </button>
          `).join('')}
        </div>

        <section class="item-list mt-16">
          ${cachedItems.length
            ? cachedItems.map(itemRow).join('')
            : `<div class="card">${emptyState('Barang belum tersedia', 'fa-box-open')}</div>`}
        </section>

        <button type="button" class="fab" data-action="create-item" aria-label="Tambah barang">
          <i class="fa-solid fa-plus"></i>
        </button>
      `;
    } catch (error) {
      showError(error);
    }
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
    renderReports
  };
})();
