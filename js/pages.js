
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

  // [ADDED] Beranda berdasarkan dashboard API.
  async function renderHome() {
    showLoading();

    try {
      const [dashboardResult, itemsResult] = await Promise.all([
        API.getDashboard(),
        API.getItems()
      ]);

      cachedDashboard = dashboardResult.data;
      cachedItems = itemsResult.data || [];

      const summary = cachedDashboard.summary;
      const stock = summary.stock;
      const monthly = summary.monthly;
      const movements = cachedDashboard.recent_movements || [];
      const alerts = cachedDashboard.stock_alerts || [];

      content().innerHTML = `
        ${heroCard(stock.total_items)}

        <div class="stat-grid mt-12">
          ${statCard(
            'fa-arrow-down',
            'Stok Masuk Bulan Ini',
            `+${number(monthly.total_in_quantity)}`,
            'green'
          )}
          ${statCard(
            'fa-arrow-up',
            'Stok Keluar Bulan Ini',
            `-${number(monthly.total_out_quantity)}`,
            'red'
          )}
          ${statCard(
            'fa-triangle-exclamation',
            'Stok Menipis',
            number(stock.low_stock_items),
            'orange'
          )}
          ${statCard(
            'fa-coins',
            'Estimasi Laba',
            money(monthly.estimated_profit),
            'blue'
          )}
        </div>

        <div class="section-heading">
          <h3>Stok Menipis</h3>
          <button type="button" class="text-link" data-action="low-stock">
            Lihat Semua <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>

        <section class="item-list">
          ${alerts.length
            ? alerts.map((item) => itemRow(item)).join('')
            : `<div class="card">${emptyState('Semua stok masih aman', 'fa-circle-check')}</div>`}
        </section>

        <div class="button-row mt-16">
          <button type="button" class="button" data-action="stock-in">
            <i class="fa-solid fa-plus"></i> Barang Masuk
          </button>
          <button type="button" class="button button-danger" data-action="stock-out">
            <i class="fa-solid fa-minus"></i> Barang Keluar
          </button>
        </div>

        <div class="section-heading">
          <h3>Transaksi Terbaru</h3>
          <button type="button" class="text-link" data-action="all-movements">
            Lihat Semua <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>

        <section class="card movement-list">
          ${movements.length
            ? movements.map(movementRow).join('')
            : emptyState('Belum ada transaksi', 'fa-clock-rotate-left')}
        </section>
      `;
    } catch (error) {
      showError(error);
    }
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

          <div class="form-grid">
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
      const [itemResult, movementsResult] = await Promise.all([
        API.getItem(id),
        API.getItemMovements(id, 10, 0)
      ]);

      const item = itemResult.data;
      selectedItemId = item.id;

      content().innerHTML = `
        <div class="page-heading">
          <button type="button" class="icon-button" data-action="back-items" aria-label="Kembali">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <h2>Detail Barang</h2>
          <button type="button" class="icon-button" data-action="edit-item" data-id="${Number(item.id)}" aria-label="Edit">
            <i class="fa-solid fa-pen"></i>
          </button>
        </div>

        <section class="card">
          <div class="product-detail-head">
            ${itemImage(item)}
            <div>
              <h2>${escapeHtml(item.name)}</h2>
              <p>${escapeHtml(item.code)}</p>
              ${statusFor(item)}
            </div>
          </div>

          <div class="detail-grid">
            <div class="detail-value">
              <span>Stok Saat Ini</span>
              <strong>${number(item.current_stock)} ${escapeHtml(item.unit)}</strong>
            </div>
            <div class="detail-value ${item.is_low_stock ? 'warning' : ''}">
              <span>Stok Minimum</span>
              <strong>${number(item.minimum_stock)} ${escapeHtml(item.unit)}</strong>
            </div>
          </div>

          <div class="detail-grid">
            <div class="detail-value">
              <span>Harga Modal</span>
              <strong>${money(item.cost_price)}</strong>
            </div>
            <div class="detail-value">
              <span>Harga Keluar</span>
              <strong>${money(item.outgoing_price)}</strong>
            </div>
          </div>

          <div class="row-between mt-12">
            <button type="button" class="button" data-action="stock-in" data-id="${Number(item.id)}">
              <i class="fa-solid fa-plus"></i> Stok Masuk
            </button>
            <button type="button" class="button button-danger" data-action="stock-out" data-id="${Number(item.id)}">
              <i class="fa-solid fa-minus"></i> Stok Keluar
            </button>
          </div>

          <table class="detail-table mt-16">
            <tbody>
              <tr><td>Kategori</td><td>${escapeHtml(item.category_name || '-')}</td></tr>
              <tr><td>Satuan</td><td>${escapeHtml(item.unit)}</td></tr>
              <tr><td>Stok Awal</td><td>${number(item.initial_stock)} ${escapeHtml(item.unit)}</td></tr>
              <tr><td>Nilai Modal Stok</td><td>${money(item.stock_cost_value)}</td></tr>
              <tr><td>Estimasi Nilai Jual</td><td>${money(item.stock_outgoing_value)}</td></tr>
              <tr><td>Deskripsi</td><td>${escapeHtml(item.description || '-')}</td></tr>
            </tbody>
          </table>
        </section>

        <div class="section-heading">
          <h3>Riwayat Transaksi</h3>
        </div>

        <section class="card movement-list">
          ${(movementsResult.data || []).length
            ? movementsResult.data.map(movementRow).join('')
            : emptyState('Belum ada riwayat transaksi', 'fa-clock-rotate-left')}
        </section>

        <button type="button" class="button button-outline-danger button-block mt-16"
                data-action="deactivate-item" data-id="${Number(item.id)}">
          <i class="fa-regular fa-trash-can"></i> Nonaktifkan Barang
        </button>
      `;
    } catch (error) {
      showError(error);
    }
  }

  // [ADDED] Form transaksi stok masuk/keluar.
  async function renderStockForm(type, itemId = null) {
    showLoading();

    try {
      const result = await API.getItems();
      cachedItems = result.data || [];

      const isIn = type === 'in';
      const item = itemId
        ? cachedItems.find((entry) => Number(entry.id) === Number(itemId))
        : null;

      selectedItemId = itemId;

      content().innerHTML = `
        <div class="page-heading">
          <button type="button" class="icon-button" data-action="back-items" aria-label="Kembali">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <h2>Barang ${isIn ? 'Masuk' : 'Keluar'}</h2>
          <span style="width:40px"></span>
        </div>

        <form id="stock-form" class="card form-stack">
          <div class="form-group">
            <label>Pilih Barang <span class="required">*</span></label>
            <select class="select" name="item_id" id="stock-item-select" required>
              <option value="">Pilih barang...</option>
              ${cachedItems.map((entry) => `
                <option value="${Number(entry.id)}"
                  ${item && Number(item.id) === Number(entry.id) ? 'selected' : ''}>
                  ${escapeHtml(entry.name)} (${escapeHtml(entry.code)})
                </option>
              `).join('')}
            </select>
          </div>

          <div id="stock-item-info"></div>

          <div class="form-group">
            <label>Jumlah ${isIn ? 'Masuk' : 'Keluar'} <span class="required">*</span></label>
            <input class="input" type="number" name="quantity" min="0.000001"
                   step="any" required placeholder="Masukkan jumlah">
          </div>

          <div class="form-group">
            <label>Harga ${isIn ? 'Modal' : 'Keluar'} <span class="required">*</span></label>
            <div class="input-with-suffix">
              <input class="input" type="number"
                     name="unit_${isIn ? 'cost' : 'outgoing_price'}"
                     id="stock-price-input" min="0" step="any" required
                     value="${item ? Number(isIn ? item.cost_price : item.outgoing_price) : ''}">
              <span class="input-suffix">Rp</span>
            </div>
          </div>

          ${isIn ? `
            <div class="form-group">
              <label>Supplier</label>
              <input class="input" name="supplier" maxlength="150"
                     placeholder="Nama supplier">
            </div>
          ` : `
            <div class="form-group">
              <label>Tujuan / Keperluan</label>
              <input class="input" name="destination" maxlength="150"
                     placeholder="Contoh: kebutuhan dapur">
            </div>
          `}

          <div class="form-group">
            <label>Tanggal <span class="required">*</span></label>
            <input class="input" type="date" name="occurred_at_date"
                   value="${today()}" required>
          </div>

          <div class="form-group">
            <label>Catatan</label>
            <textarea class="textarea" name="note" maxlength="500"
                      placeholder="Catatan opsional..."></textarea>
          </div>

          <button type="submit"
                  class="button button-block ${isIn ? '' : 'button-danger'}"
                  id="save-stock-button">
            <i class="fa-solid fa-floppy-disk"></i>
            Simpan Barang ${isIn ? 'Masuk' : 'Keluar'}
          </button>
        </form>
      `;

      const select = document.getElementById('stock-item-select');

      const updateSelectedItem = () => {
        const selected = cachedItems.find(
          (entry) => Number(entry.id) === Number(select.value)
        );

        const info = document.getElementById('stock-item-info');
        const priceInput = document.getElementById('stock-price-input');

        if (!selected) {
          info.innerHTML = '';
          priceInput.value = '';
          return;
        }

        priceInput.value = Number(
          isIn ? selected.cost_price : selected.outgoing_price
        );

        info.innerHTML = `
          <div class="detail-value">
            <span>Stok tersedia</span>
            <strong>${number(selected.current_stock)} ${escapeHtml(selected.unit)}</strong>
          </div>
        `;
      };

      select.addEventListener('change', updateSelectedItem);
      updateSelectedItem();

      document.getElementById('stock-form').addEventListener('submit', async (event) => {
        event.preventDefault();

        const form = event.currentTarget;
        const formData = Object.fromEntries(new FormData(form).entries());
        const button = document.getElementById('save-stock-button');

        const payload = {
          quantity: Number(formData.quantity),
          note: formData.note.trim() || undefined,
          occurred_at: new Date(
            `${formData.occurred_at_date}T12:00:00`
          ).toISOString()
        };

        if (isIn) {
          payload.unit_cost = Number(formData.unit_cost);
          payload.supplier = formData.supplier.trim() || undefined;
        } else {
          payload.unit_outgoing_price = Number(formData.unit_outgoing_price);
          payload.destination = formData.destination.trim() || undefined;
        }

        button.disabled = true;
        button.textContent = 'Menyimpan...';

        try {
          if (isIn) {
            await API.stockIn(formData.item_id, payload);
          } else {
            await API.stockOut(formData.item_id, payload);
          }

          window.dispatchEvent(new CustomEvent('exgudang:toast', {
            detail: {
              message: `Transaksi stok ${isIn ? 'masuk' : 'keluar'} berhasil`,
              type: 'success'
            }
          }));

          window.ExGudangApp.navigate('detail', {
            id: Number(formData.item_id)
          });
        } catch (error) {
          window.dispatchEvent(new CustomEvent('exgudang:toast', {
            detail: { message: error.message, type: 'error' }
          }));

          button.disabled = false;
          button.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Simpan Barang ${isIn ? 'Masuk' : 'Keluar'}`;
        }
      });
    } catch (error) {
      showError(error);
    }
  }

  // [ADDED] Laporan ringkas.
  async function renderReports() {
    showLoading();

    try {
      const result = await API.getReportSummary();
      const stock = result.data;

      activeReport = 'summary';

      content().innerHTML = `
        <div class="page-heading">
          <h2>Laporan</h2>
        </div>

        <section class="report-grid">
          <div class="report-card">
            <p class="report-label">Total Barang</p>
            <p class="report-value">${number(stock.total_items)}</p>
          </div>
          <div class="report-card">
            <p class="report-label">Jumlah Stok</p>
            <p class="report-value">${number(stock.total_stock_units)}</p>
          </div>
          <div class="report-card">
            <p class="report-label">Nilai Modal Stok</p>
            <p class="report-value text-green">${money(stock.total_stock_cost_value)}</p>
          </div>
          <div class="report-card">
            <p class="report-label">Estimasi Nilai Jual</p>
            <p class="report-value">${money(stock.total_stock_outgoing_value)}</p>
          </div>
          <div class="report-card">
            <p class="report-label">Stok Menipis</p>
            <p class="report-value text-orange">${number(stock.low_stock_items)} barang</p>
          </div>
          <div class="report-card">
            <p class="report-label">Stok Habis</p>
            <p class="report-value text-red">${number(stock.empty_stock_items)} barang</p>
          </div>
        </section>

        <div class="section-heading">
          <h3>Jenis Laporan</h3>
        </div>

        <section class="item-list">
          <button type="button" class="item-row" data-action="report-items">
            <div class="stat-icon" style="color:var(--green);background:var(--green-light)">
              <i class="fa-solid fa-boxes-stacked"></i>
            </div>
            <div class="item-info">
              <p class="item-name">Laporan Barang</p>
              <p class="item-price">Daftar barang dan stok terkini</p>
            </div>
            <i class="fa-solid fa-chevron-right text-muted"></i>
          </button>

          <button type="button" class="item-row" data-action="report-profit">
            <div class="stat-icon" style="color:var(--blue);background:var(--blue-light)">
              <i class="fa-solid fa-chart-line"></i>
            </div>
            <div class="item-info">
              <p class="item-name">Laporan Keuntungan</p>
              <p class="item-price">Ringkasan transaksi dan estimasi laba kotor</p>
            </div>
            <i class="fa-solid fa-chevron-right text-muted"></i>
          </button>

          <button type="button" class="item-row" data-action="report-stock">
            <div class="stat-icon" style="color:var(--orange);background:var(--orange-light)">
              <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div class="item-info">
              <p class="item-name">Laporan Stok</p>
              <p class="item-price">Pantau barang menipis dan habis</p>
            </div>
            <i class="fa-solid fa-chevron-right text-muted"></i>
          </button>
        </section>
      `;
    } catch (error) {
      showError(error);
    }
  }

  // [ADDED] Laporan barang.
  async function renderReportItems() {
    showLoading();

    try {
      const result = await API.getItems();
      const items = result.data || [];

      content().innerHTML = `
        <div class="page-heading">
          <button type="button" class="icon-button" data-action="back-reports" aria-label="Kembali">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <h2>Laporan Barang</h2>
        </div>

        <section class="report-grid">
          <div class="report-card">
            <p class="report-label">Total Barang</p>
            <p class="report-value">${number(items.length)}</p>
          </div>
          <div class="report-card">
            <p class="report-label">Barang Menipis</p>
            <p class="report-value text-orange">
              ${items.filter((item) => Number(item.current_stock) <= Number(item.minimum_stock)).length}
            </p>
          </div>
        </section>

        <section class="item-list mt-16">
          ${items.length
            ? items.map(itemRow).join('')
            : `<div class="card">${emptyState('Belum ada barang')}</div>`}
        </section>
      `;
    } catch (error) {
      showError(error);
    }
  }

  // [ADDED] Laporan keuntungan per periode.
  async function renderReportProfit() {
    showLoading();

    try {
      const date = new Date();
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const startDate = `${month}-01`;
      const endDate = today();

      const result = await API.getMovementReport(startDate, endDate);
      const data = result.data;

      content().innerHTML = `
        <div class="page-heading">
          <button type="button" class="icon-button" data-action="back-reports" aria-label="Kembali">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <h2>Laporan Keuntungan</h2>
        </div>

        <section class="card">
          <div class="form-group">
            <label>Periode</label>
            <div class="input-with-suffix">
              <input class="input" id="profit-start-date" type="date" value="${startDate}">
              <span class="input-suffix">Mulai</span>
            </div>
            <div class="input-with-suffix">
              <input class="input" id="profit-end-date" type="date" value="${endDate}">
              <span class="input-suffix">Akhir</span>
            </div>
            <button type="button" class="button button-block" data-action="apply-profit-period">
              Terapkan Periode
            </button>
          </div>

          <div class="divider"></div>

          <p class="card-title">Estimasi Keuntungan Kotor</p>
          <p class="card-value text-green">${money(data.estimated_profit)}</p>
          <p class="card-subtitle">Periode ${startDate} s/d ${endDate}</p>
        </section>

        <section class="report-grid mt-16">
          <div class="report-card">
            <p class="report-label">Nilai Stok Keluar</p>
            <p class="report-value">${money(data.total_outgoing_value)}</p>
          </div>
          <div class="report-card">
            <p class="report-label">Modal Barang Keluar</p>
            <p class="report-value">${money(data.total_out_cost_value)}</p>
          </div>
          <div class="report-card">
            <p class="report-label">Jumlah Masuk</p>
            <p class="report-value text-green">${number(data.total_in_quantity)}</p>
          </div>
          <div class="report-card">
            <p class="report-label">Jumlah Keluar</p>
            <p class="report-value text-red">${number(data.total_out_quantity)}</p>
          </div>
        </section>

        <p class="form-hint mt-12">
          Estimasi laba kotor belum dikurangi biaya operasional.
        </p>
      `;
    } catch (error) {
      showError(error);
    }
  }

  async function applyProfitPeriod() {
    const startDate = document.getElementById('profit-start-date')?.value;
    const endDate = document.getElementById('profit-end-date')?.value;

    if (startDate && endDate && startDate > endDate) {
      window.dispatchEvent(new CustomEvent('exgudang:toast', {
        detail: {
          message: 'Tanggal awal tidak boleh melewati tanggal akhir',
          type: 'error'
        }
      }));
      return;
    }

    try {
      const result = await API.getMovementReport(startDate, endDate);
      const data = result.data;

      const card = content().querySelector('.card');
      if (card) {
        const profit = card.querySelector('.card-value');
        const period = card.querySelector('.card-subtitle');

        if (profit) profit.textContent = money(data.estimated_profit);
        if (period) period.textContent = `Periode ${startDate || 'awal'} s/d ${endDate || 'sekarang'}`;
      }

      const cards = content().querySelectorAll('.report-card .report-value');

      if (cards[0]) cards[0].textContent = money(data.total_outgoing_value);
      if (cards[1]) cards[1].textContent = money(data.total_out_cost_value);
      if (cards[2]) cards[2].textContent = number(data.total_in_quantity);
      if (cards[3]) cards[3].textContent = number(data.total_out_quantity);
    } catch (error) {
      window.dispatchEvent(new CustomEvent('exgudang:toast', {
        detail: { message: error.message, type: 'error' }
      }));
    }
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
      default:
        return renderHome();
    }
  }

  // [ADDED] Handler untuk aksi yang butuh fungsi tambahan.
  async function handleAction(action, id, element) {
    switch (action) {
      case 'reload':
        return render(window.ExGudangApp.currentPage);
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
        return render('report-profit');
      case 'report-items':
        return render('report-items');
      case 'report-profit':
        return render('report-profit');
      case 'report-stock':
        return render('report-stock');
      case 'apply-profit-period':
        return applyProfitPeriod();
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
