'use strict';

// ExGudang API lokal: data disimpan di localStorage, tanpa backend dan tanpa login.
window.ExGudangAPI = (() => {
  const KEY = 'exgudang_data_v1';

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.items) return d;
    } catch {}
    return {
      seq: { item: 0, move: 0, cat: 3 },
      categories: [
        { id: 1, name: 'Bahan Baku' },
        { id: 2, name: 'Bumbu' },
        { id: 3, name: 'Minuman' }
      ],
      items: [],
      movements: []
    };
  }

  const db = load();
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  const ok = (data) => Promise.resolve({ success: true, data });
  const fail = (msg) => Promise.reject(new Error(msg));
  const num = (v) => Number(v || 0);
  const catName = (id) => (db.categories.find((c) => c.id === id) || {}).name || null;

  function view(i) {
    const stock = num(i.current_stock);
    return {
      ...i,
      category_name: catName(i.category_id),
      is_low_stock: stock <= num(i.minimum_stock),
      stock_cost_value: stock * num(i.cost_price),
      stock_outgoing_value: stock * num(i.outgoing_price)
    };
  }

  const active = () => db.items.filter((i) => i.is_active !== false);
  const find = (id) => db.items.find((i) => i.id === Number(id) && i.is_active !== false);
  const sortedMoves = () => [...db.movements].sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));

  // Sesi: selalu dianggap masuk (aplikasi pribadi).
  const getToken = () => 'local';
  const getAdmin = () => ({ username: 'pribadi' });
  const isAuthenticated = () => true;
  const clearSession = () => {};
  const login = () => ok({ token: 'local', admin: getAdmin() });
  const logout = () => ok(null);
  const getProfile = () => ok(getAdmin());

  // Kategori
  const getCategories = () => ok([...db.categories]);
  const createCategory = (d) => { db.categories.push({ id: ++db.seq.cat, name: d.name }); save(); return ok(null); };
  const updateCategory = (id, d) => { const c = db.categories.find((x) => x.id === Number(id)); if (c) Object.assign(c, d); save(); return ok(c); };
  const deleteCategory = (id) => { db.categories = db.categories.filter((x) => x.id !== Number(id)); save(); return ok(null); };

  // Barang
  function getItems(f = {}) {
    let list = active();
    if (f.search) {
      const q = f.search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || String(i.code).toLowerCase().includes(q));
    }
    if (f.categoryId) list = list.filter((i) => i.category_id === Number(f.categoryId));
    if (f.stockStatus === 'low') list = list.filter((i) => num(i.current_stock) <= num(i.minimum_stock));
    if (f.stockStatus === 'empty') list = list.filter((i) => num(i.current_stock) <= 0);
    return ok(list.map(view));
  }

  const getItem = (id) => (find(id) ? ok(view(find(id))) : fail('Barang tidak ditemukan.'));

  function createItem(d) {
    const id = ++db.seq.item;
    const code = (d.code || '').trim() || `BRG-${String(id).padStart(3, '0')}`;
    if (db.items.some((i) => i.code === code)) { db.seq.item--; return fail('Kode barang sudah dipakai.'); }
    const stock = num(d.initial_stock);
    db.items.push({
      id, code, name: d.name, category_id: d.category_id || null, unit: d.unit,
      cost_price: num(d.cost_price), outgoing_price: num(d.outgoing_price),
      initial_stock: stock, current_stock: stock, minimum_stock: num(d.minimum_stock),
      description: d.description || null, supplier: null, image_path: null, is_active: true
    });
    save();
    return ok(view(find(id)));
  }

  function updateItem(id, d) {
    const i = find(id);
    if (!i) return fail('Barang tidak ditemukan.');
    Object.assign(i, d, { id: i.id, code: i.code, current_stock: i.current_stock });
    save();
    return ok(view(i));
  }

  function deactivateItem(id) {
    const i = find(id);
    if (!i) return fail('Barang tidak ditemukan.');
    i.is_active = false;
    save();
    return ok(null);
  }

  // Stok masuk/keluar
  function addMove(i, type, d) {
    const qty = num(d.quantity);
    if (!(qty > 0)) return fail('Jumlah harus lebih dari 0.');
    if (type === 'OUT' && qty > num(i.current_stock)) return fail('Stok tidak cukup.');
    const unitCost = type === 'IN' ? num(d.unit_cost) : num(i.cost_price);
    const unitOut = type === 'OUT' ? num(d.unit_outgoing_price) : null;
    i.current_stock = num(i.current_stock) + (type === 'IN' ? qty : -qty);
    if (type === 'IN') { i.cost_price = unitCost; if (d.supplier) i.supplier = d.supplier; }
    db.movements.push({
      id: ++db.seq.move, item_id: i.id, item_name: i.name, unit: i.unit, movement_type: type,
      quantity: qty, unit_cost: unitCost, unit_outgoing_price: unitOut,
      total_value: qty * (type === 'IN' ? unitCost : unitOut),
      supplier: d.supplier || null, destination: d.destination || null, note: d.note || null,
      occurred_at: d.occurred_at || new Date().toISOString()
    });
    save();
    return ok(view(i));
  }

  const stockIn = (id, d) => (find(id) ? addMove(find(id), 'IN', d) : fail('Barang tidak ditemukan.'));
  const stockOut = (id, d) => (find(id) ? addMove(find(id), 'OUT', d) : fail('Barang tidak ditemukan.'));
  const getItemMovements = (id, limit = 50, offset = 0) =>
    ok(sortedMoves().filter((m) => m.item_id === Number(id)).slice(offset, offset + limit));

  // Laporan
  function summarize(list) {
    const inM = list.filter((m) => m.movement_type === 'IN');
    const outM = list.filter((m) => m.movement_type === 'OUT');
    const sum = (a, f) => a.reduce((t, m) => t + f(m), 0);
    const outVal = sum(outM, (m) => num(m.total_value));
    const outCost = sum(outM, (m) => num(m.quantity) * num(m.unit_cost));
    return {
      total_in_quantity: sum(inM, (m) => num(m.quantity)),
      total_out_quantity: sum(outM, (m) => num(m.quantity)),
      total_in_value: sum(inM, (m) => num(m.total_value)),
      total_outgoing_value: outVal,
      total_out_cost_value: outCost,
      estimated_profit: outVal - outCost
    };
  }

  function stockSummary() {
    const l = active();
    return {
      total_items: l.length,
      total_stock_units: l.reduce((t, i) => t + num(i.current_stock), 0),
      total_stock_cost_value: l.reduce((t, i) => t + num(i.current_stock) * num(i.cost_price), 0),
      total_stock_outgoing_value: l.reduce((t, i) => t + num(i.current_stock) * num(i.outgoing_price), 0),
      low_stock_items: l.filter((i) => num(i.current_stock) <= num(i.minimum_stock)).length,
      empty_stock_items: l.filter((i) => num(i.current_stock) <= 0).length
    };
  }

  const getReportSummary = () => ok(stockSummary());
  const getLowStockItems = () => getItems({ stockStatus: 'low' });

  function getMovementReport(start, end) {
    const list = db.movements.filter((m) => {
      const d = String(m.occurred_at).slice(0, 10);
      return (!start || d >= start) && (!end || d <= end);
    });
    return ok(summarize(list));
  }

  const getRecentMovements = (limit = 20) => ok(sortedMoves().slice(0, limit));

  function getDashboard() {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const within = (p) => db.movements.filter((m) => String(m.occurred_at).startsWith(p));
    return ok({
      summary: { stock: stockSummary(), monthly: summarize(within(month)), daily: summarize(within(day)) },
      stock_alerts: active().filter((i) => num(i.current_stock) <= num(i.minimum_stock)).map(view),
      recent_movements: sortedMoves().slice(0, 5)
    });
  }

  return {
    getToken, getAdmin, isAuthenticated, clearSession, login, logout, getProfile,
    getDashboard, getCategories, createCategory, updateCategory, deleteCategory,
    getItems, getItem, createItem, updateItem, deactivateItem,
    stockIn, stockOut, getItemMovements,
    getReportSummary, getLowStockItems, getMovementReport, getRecentMovements
  };
})();
