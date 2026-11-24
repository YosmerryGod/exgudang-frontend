// [MODIFIED] Frontend hanya berkomunikasi dengan backend melalui HTTP.
// Tidak ada koneksi database, SQL, schema, atau kredensial database di browser.

// [MODIFIED] Menggunakan API_URL agar nama variabel Vercel tidak perlu awalan VITE_.
const API_BASE_URL = (import.meta.env.API_URL || '/api').replace(/\/+$/, '');
const TOKEN_KEY = 'exgudang_token';
const ADMIN_KEY = 'exgudang_admin';

const getToken = () => localStorage.getItem(TOKEN_KEY);
const getAdmin = () => {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null');
  } catch {
    return null;
  }
};
const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
};
const isAuthenticated = () => Boolean(getToken() && getAdmin());

function createError(message, statusCode = 500) {
  const error = new Error(message || 'Terjadi kesalahan pada server.');
  error.statusCode = statusCode;
  return error;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getToken();
  if (token && !options.skipAuth) headers.set('Authorization', `Bearer ${token}`);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      body: options.body instanceof FormData
        ? options.body
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    });
  } catch {
    throw createError('Tidak dapat terhubung ke backend. Periksa alamat API dan koneksi server.', 0);
  }

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    const message = await response.text();
    if (message) payload = { message };
  }

  if (!response.ok || payload?.success === false) {
    const message = payload?.message || payload?.error || `Request gagal (HTTP ${response.status}).`;
    throw createError(message, response.status);
  }

  return payload ?? { success: true, data: null };
}

function guarded(fn, handleUnauthorized = true) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (handleUnauthorized && error.statusCode === 401) {
        clearSession();
        window.dispatchEvent(new CustomEvent('exgudang:unauthorized'));
      }
      throw error;
    }
  };
}

const ok = (data, extra = {}) => ({ success: true, data, ...extra });
const encode = (value) => encodeURIComponent(String(value));
const queryString = (values) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
};

async function login(username, password) {
  const result = await request('/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: { username, password }
  });
  const data = result.data || result;
  if (!data.token || !data.admin) {
    throw createError('Respons login backend tidak berisi token dan data admin.');
  }
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(ADMIN_KEY, JSON.stringify(data.admin));
  return { ...result, data };
}

async function logout() {
  try {
    if (getToken()) await request('/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
    window.dispatchEvent(new CustomEvent('exgudang:logout'));
  }
}

async function getProfile() {
  const result = await request('/auth/me');
  const data = result.data || result;
  const admin = data.admin || data;
  if (admin && typeof admin === 'object') localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
  return ok(admin);
}

async function getDashboard() { return request('/dashboard'); }
async function getCategories() { return request('/categories'); }
async function createCategory(data) { return request('/categories', { method: 'POST', body: data }); }
async function updateCategory(id, data) { return request(`/categories/${encode(id)}`, { method: 'PATCH', body: data }); }
async function deleteCategory(id) { return request(`/categories/${encode(id)}`, { method: 'DELETE' }); }

async function getItems(filters = {}) {
  return request(`/items${queryString({
    search: filters.search,
    categoryId: filters.categoryId,
    stockStatus: filters.stockStatus
  })}`);
}
async function getItem(id) { return request(`/items/${encode(id)}`); }
async function createItem(data) { return request('/items', { method: 'POST', body: data }); }
async function updateItem(id, data) { return request(`/items/${encode(id)}`, { method: 'PATCH', body: data }); }
async function deactivateItem(id) { return request(`/items/${encode(id)}`, { method: 'DELETE' }); }

async function stockIn(id, data) {
  return request(`/items/${encode(id)}/stock-in`, { method: 'POST', body: data });
}
async function stockOut(id, data) {
  return request(`/items/${encode(id)}/stock-out`, { method: 'POST', body: data });
}
async function getItemMovements(id, limit = 50, offset = 0) {
  return request(`/items/${encode(id)}/movements${queryString({ limit, offset })}`);
}

async function getReportSummary() { return request('/reports/summary'); }
async function getLowStockItems() { return request('/reports/low-stock'); }
async function getMovementReport(startDate, endDate) {
  const response = await request(`/reports/movements${queryString({ startDate, endDate })}`);
  // [MODIFIED] Backend ExGudang mengirim agregasi laporan langsung di response.data.
  // Normalisasi juga menerima envelope data.data agar komponen laporan tidak membaca undefined.
  const report = response?.data?.data ?? response?.data ?? {};
  return { ...response, data: report };
}
async function getRecentMovements(limit = 20) {
  return request(`/movements/recent${queryString({ limit })}`);
}

window.ExGudangAPI = {
  getToken,
  getAdmin,
  isAuthenticated,
  clearSession,
  login: guarded(login, false),
  logout,
  getProfile: guarded(getProfile),
  getDashboard: guarded(getDashboard),
  getCategories: guarded(getCategories),
  createCategory: guarded(createCategory),
  updateCategory: guarded(updateCategory),
  deleteCategory: guarded(deleteCategory),
  getItems: guarded(getItems),
  getItem: guarded(getItem),
  createItem: guarded(createItem),
  updateItem: guarded(updateItem),
  deactivateItem: guarded(deactivateItem),
  stockIn: guarded(stockIn),
  stockOut: guarded(stockOut),
  getItemMovements: guarded(getItemMovements),
  getReportSummary: guarded(getReportSummary),
  getLowStockItems: guarded(getLowStockItems),
  getMovementReport: guarded(getMovementReport),
  getRecentMovements: guarded(getRecentMovements)
};
