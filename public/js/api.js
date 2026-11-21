'use strict';

// ExGudang API Client (versi backend)
window.ExGudangAPI = (() => {
  // [MODIFIED] Gunakan API serverless pada domain Vercel yang sama.
  const API_BASE = '/api';
  const TOKEN_KEY = 'exgudang_token';
  const ADMIN_KEY = 'exgudang_admin';
  const TIMEOUT_MS = 15000;

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function saveSession(token, admin) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
  }

  function getAdmin() {
    try {
      return JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function isAuthenticated() {
    return Boolean(getToken());
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});

    if (options.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    // Batas waktu agar aplikasi tidak menggantung bila server lambat.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;

    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        cache: 'no-store',
        signal: controller.signal
      });
    } catch (error) {
      // [MODIFIED] Bedakan timeout dan kegagalan koneksi agar penyebab terlihat di aplikasi.
      if (error && error.name === 'AbortError') {
        throw new Error('Request ke server timeout setelah 15 detik. Periksa koneksi atau status API.');
      }
      throw new Error(
        'Gagal menghubungi API: ' + (error && error.message ? error.message : 'koneksi ditolak atau server tidak dapat dijangkau.')
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let result;

    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      // [MODIFIED] Tampilkan status HTTP dan cuplikan respons non-JSON (misalnya error Vercel).
      const contentType = response.headers.get('content-type') || 'tidak diketahui';
      const responseDetail = text ? text.replace(/\\s+/g, ' ').slice(0, 500) : 'Body respons kosong.';
      throw new Error(
        `API mengembalikan respons non-JSON. HTTP ${response.status}; Content-Type: ${contentType}; Detail: ${responseDetail}`
      );
    }

    const isLoginRequest = path === '/auth/login';

    // [MODIFIED] Kesalahan kredensial login 401 harus menampilkan pesan API,
    // bukan dianggap sebagai sesi pengguna yang kedaluwarsa.
    if (response.status === 401 && !isLoginRequest) {
      clearSession();
      window.dispatchEvent(new CustomEvent('exgudang:unauthorized'));
      throw new Error(result.message || 'Sesi login berakhir. Silakan login kembali.');
    }

    if (!response.ok || result.success === false) {
      const details = result.detail
        ? ` Detail: ${result.detail}${result.errorCode ? ` (Kode: ${result.errorCode})` : ''}`
        : '';
      throw new Error((result.message || `Permintaan gagal (HTTP ${response.status}).`) + details);
    }

    return result;
  }

  const get = (path) => request(path, { method: 'GET' });
  const post = (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) });
  const patch = (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data) });
  const remove = (path) => request(path, { method: 'DELETE' });
  const enc = encodeURIComponent;

  // Autentikasi
  async function login(username, password) {
    const result = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (!result.data || !result.data.token || !result.data.admin) {
      throw new Error('Respons login tidak lengkap.');
    }

    saveSession(result.data.token, result.data.admin);
    return result.data;
  }

  async function logout() {
    clearSession();
    window.dispatchEvent(new CustomEvent('exgudang:logout'));
  }

  const getProfile = () => get('/auth/me');
  const getDashboard = () => get('/dashboard');

  // Kategori
  const getCategories = () => get('/categories');
  const createCategory = (data) => post('/categories', data);
  const updateCategory = (id, data) => patch(`/categories/${enc(id)}`, data);
  const deleteCategory = (id) => remove(`/categories/${enc(id)}`);

  // Barang
  async function getItems(filters = {}) {
    const params = new URLSearchParams();

    if (filters.search) params.set('search', filters.search);
    if (filters.categoryId) params.set('categoryId', String(filters.categoryId));
    if (filters.stockStatus) params.set('stockStatus', filters.stockStatus);

    const query = params.toString();
    return get(`/items${query ? `?${query}` : ''}`);
  }

  const getItem = (id) => get(`/items/${enc(id)}`);
  const createItem = (data) => post('/items', data);
  const updateItem = (id, data) => patch(`/items/${enc(id)}`, data);
  const deactivateItem = (id) => remove(`/items/${enc(id)}`);

  // Stok masuk dan keluar
  const stockIn = (id, data) => post(`/items/${enc(id)}/stock-in`, data);
  const stockOut = (id, data) => post(`/items/${enc(id)}/stock-out`, data);

  function getItemMovements(id, limit = 50, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return get(`/items/${enc(id)}/movements?${params.toString()}`);
  }

  // Laporan
  const getReportSummary = () => get('/reports/summary');
  const getLowStockItems = () => get('/reports/low-stock');

  function getMovementReport(startDate, endDate) {
    const params = new URLSearchParams();

    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    const query = params.toString();
    return get(`/reports/movements${query ? `?${query}` : ''}`);
  }

  function getRecentMovements(limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) });
    return get(`/reports/recent-movements?${params.toString()}`);
  }

  return {
    getToken, getAdmin, isAuthenticated, clearSession, login, logout, getProfile,
    getDashboard, getCategories, createCategory, updateCategory, deleteCategory,
    getItems, getItem, createItem, updateItem, deactivateItem,
    stockIn, stockOut, getItemMovements,
    getReportSummary, getLowStockItems, getMovementReport, getRecentMovements
  };
})();
