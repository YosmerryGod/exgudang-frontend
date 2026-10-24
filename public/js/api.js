'use strict';

// ExGudang API Client (versi backend)
window.ExGudangAPI = (() => {
  const API_BASE = 'https://apigudang.doodweb.tech/api';
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
    } catch {
      throw new Error(
        'Tidak dapat terhubung ke server. Periksa apakah backend sedang berjalan.'
      );
    } finally {
      clearTimeout(timer);
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
      window.dispatchEvent(new CustomEvent('exgudang:unauthorized'));
      throw new Error('Sesi login berakhir. Silakan login kembali.');
    }

    if (!response.ok || result.success === false) {
      throw new Error(result.message || `Permintaan gagal (${response.status}).`);
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
