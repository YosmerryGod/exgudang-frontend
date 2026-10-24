
'use strict';

// ExGudang API Client
// [ADDED] Semua permintaan frontend menuju backend pada origin yang sama.
window.ExGudangAPI = (() => {
  const API_BASE = 'https://apigudang.doodweb.tech/api';
  const TOKEN_KEY = 'exgudang_token';
  const ADMIN_KEY = 'exgudang_admin';

  // [ADDED] Mengelola token autentikasi.
  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function saveSession(token, admin) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_KEY);
  }

  function getAdmin() {
    try {
      return JSON.parse(sessionStorage.getItem(ADMIN_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function isAuthenticated() {
    return Boolean(getToken());
  }

  // [ADDED] Pembungkus fetch untuk semua endpoint API.
  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});

    if (options.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const token = getToken();

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let response;

    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        cache: 'no-store'
      });
    } catch {
      throw new Error(
        'Tidak dapat terhubung ke server. Periksa apakah backend sedang berjalan.'
      );
    }

    const text = await response.text();
    let result;

    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('Server mengembalikan respons yang tidak valid.');
    }

    if (response.status === 401) {
      clearSession();

      window.dispatchEvent(
        new CustomEvent('exgudang:unauthorized')
      );

      throw new Error('Sesi login berakhir. Silakan login kembali.');
    }

    if (!response.ok || result.success === false) {
      throw new Error(
        result.message || `Permintaan gagal (${response.status}).`
      );
    }

    return result;
  }

  // [ADDED] Helper HTTP.
  function get(path) {
    return request(path, { method: 'GET' });
  }

  function post(path, data) {
    return request(path, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  function patch(path, data) {
    return request(path, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  function remove(path) {
    return request(path, { method: 'DELETE' });
  }

  // [ADDED] Autentikasi admin.
  async function login(username, password) {
    const result = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (
      !result.data ||
      !result.data.token ||
      !result.data.admin
    ) {
      throw new Error('Respons login tidak lengkap.');
    }

    saveSession(result.data.token, result.data.admin);

    return result.data;
  }

  async function logout() {
    clearSession();
    window.dispatchEvent(new CustomEvent('exgudang:logout'));
  }

  async function getProfile() {
    return get('/auth/me');
  }

  // [ADDED] API dashboard.
  async function getDashboard() {
    return get('/dashboard');
  }

  // [ADDED] API kategori.
  async function getCategories() {
    return get('/categories');
  }

  async function createCategory(data) {
    return post('/categories', data);
  }

  async function updateCategory(id, data) {
    return patch(`/categories/${encodeURIComponent(id)}`, data);
  }

  async function deleteCategory(id) {
    return remove(`/categories/${encodeURIComponent(id)}`);
  }

  // [ADDED] API barang.
  async function getItems(filters = {}) {
    const params = new URLSearchParams();

    if (filters.search) params.set('search', filters.search);
    if (filters.categoryId) {
      params.set('categoryId', String(filters.categoryId));
    }
    if (filters.stockStatus) {
      params.set('stockStatus', filters.stockStatus);
    }

    const query = params.toString();

    return get(`/items${query ? `?${query}` : ''}`);
  }

  async function getItem(id) {
    return get(`/items/${encodeURIComponent(id)}`);
  }

  async function createItem(data) {
    return post('/items', data);
  }

  async function updateItem(id, data) {
    return patch(`/items/${encodeURIComponent(id)}`, data);
  }

  async function deactivateItem(id) {
    return remove(`/items/${encodeURIComponent(id)}`);
  }

  // [ADDED] API stok masuk dan keluar.
  async function stockIn(id, data) {
    return post(`/items/${encodeURIComponent(id)}/stock-in`, data);
  }

  async function stockOut(id, data) {
    return post(`/items/${encodeURIComponent(id)}/stock-out`, data);
  }

  async function getItemMovements(id, limit = 50, offset = 0) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });

    return get(
      `/items/${encodeURIComponent(id)}/movements?${params.toString()}`
    );
  }

  // [ADDED] API laporan.
  async function getReportSummary() {
    return get('/reports/summary');
  }

  async function getLowStockItems() {
    return get('/reports/low-stock');
  }

  async function getMovementReport(startDate, endDate) {
    const params = new URLSearchParams();

    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    const query = params.toString();

    return get(`/reports/movements${query ? `?${query}` : ''}`);
  }

  async function getRecentMovements(limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) });

    return get(`/reports/recent-movements?${params.toString()}`);
  }

  return {
    getToken,
    getAdmin,
    isAuthenticated,
    clearSession,
    login,
    logout,
    getProfile,
    getDashboard,
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    getItems,
    getItem,
    createItem,
    updateItem,
    deactivateItem,
    stockIn,
    stockOut,
    getItemMovements,
    getReportSummary,
    getLowStockItems,
    getMovementReport,
    getRecentMovements
  };
})();
