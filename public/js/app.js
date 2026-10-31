
'use strict';

(() => {
  const API = window.ExGudangAPI;
  const Pages = window.ExGudangPages;
  const content = document.getElementById('page-content');
  const header = document.querySelector('.app-header');
  const bottomNav = document.querySelector('.bottom-nav');

  // [ADDED] Tema terang/gelap tersimpan untuk seluruh aplikasi.
  const THEME_KEY = 'aigud_theme';
  function applyTheme(theme) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const icon = button.querySelector('i');
      if (icon) icon.className = nextTheme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      button.setAttribute('aria-label', nextTheme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
      button.setAttribute('title', nextTheme === 'dark' ? 'Mode terang' : 'Mode gelap');
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', nextTheme === 'dark' ? '#181d24' : '#e0e5ec');
  }
  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
  }
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-theme-toggle]')) toggleTheme();
  });

  const state = {
    currentPage: 'home',
    currentParams: {},
    previousPage: 'home'
  };

  // [ADDED] Publikasikan navigasi untuk modul halaman.
  window.ExGudangApp = {
    get currentPage() {
      return state.currentPage;
    },

    navigate(page, params = {}) {
      if (state.currentPage !== page) {
        state.previousPage = state.currentPage;
      }

      state.currentPage = page;
      state.currentParams = params;

      updateNavigation();
      return renderCurrentPage();
    },

    async confirm(title, message) {
      const dialog = document.getElementById('confirm-dialog');
      const titleElement = document.getElementById('confirm-title');
      const messageElement = document.getElementById('confirm-message');

      if (!dialog || typeof dialog.showModal !== 'function') {
        return window.confirm(message);
      }

      titleElement.textContent = title;
      messageElement.textContent = message;
      dialog.returnValue = 'cancel';

      dialog.showModal();

      return new Promise((resolve) => {
        dialog.addEventListener('close', () => {
          resolve(dialog.returnValue === 'confirm');
        }, { once: true });
      });
    }
  };

  // [ADDED] Peta halaman ke tab navigasi bawah.
  function updateNavigation() {
    const tabPage = {
      home: 'home',
      items: 'items',
      'item-form': 'items',
      detail: 'items',
      'stock-in': 'items',
      'stock-out': 'items',
      reports: 'reports',
      'report-items': 'reports',
      'report-profit': 'reports',
      'report-stock': 'reports'
    };

    const activePage = tabPage[state.currentPage] || 'home';

    document.querySelectorAll('.nav-item').forEach((button) => {
      const active = button.dataset.page === activePage;

      button.classList.toggle('active', active);

      if (active) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    });
  }

  // [ADDED] Render halaman aktif.
  async function renderCurrentPage() {
    if (!API.isAuthenticated()) {
      renderLogin();
      return;
    }

    header.classList.remove('hidden');
    bottomNav.classList.remove('hidden');

    try {
      await Pages.render(state.currentPage, state.currentParams);
    } catch (error) {
      showToast(error.message || 'Terjadi kesalahan.', 'error');
    }
  }

  // [ADDED] Form login admin.
  function renderLogin() {
    header.classList.add('hidden');
    bottomNav.classList.add('hidden');

    content.innerHTML = `
      <section class="login-screen">
        <button type="button" class="login-theme-toggle" data-theme-toggle aria-label="Aktifkan mode gelap" title="Ganti tema"><i class="fa-solid fa-moon"></i></button>
        <form class="login-card form-stack" id="login-form">
          <div class="login-brand">
            <div class="brand-icon">
              <i class="fa-solid fa-box-open"></i>
            </div>
            <h2>AIGUD</h2>
            <p>Masuk untuk mengelola stok pribadimu</p>
          </div>

          <div class="form-group">
            <label for="login-username">Username</label>
            <input class="input" id="login-username" name="username"
                   autocomplete="username" required maxlength="100"
                   placeholder="Masukkan username">
          </div>

          <div class="form-group">
            <label for="login-password">Password</label>
            <input class="input" id="login-password" name="password"
                   type="password" autocomplete="current-password"
                   required maxlength="200"
                   placeholder="Masukkan password">
          </div>

          <p id="login-error" class="text-red hidden" role="alert"></p>

          <button type="submit" class="button button-block" id="login-button">
            <i class="fa-solid fa-right-to-bracket"></i>
            Masuk
          </button>
        </form>
      </section>
    `;

    document.getElementById('login-form')
      .addEventListener('submit', handleLogin);
  }

  // [ADDED] Proses login.
  async function handleLogin(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const button = document.getElementById('login-button');
    const errorElement = document.getElementById('login-error');
    const formData = new FormData(form);

    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '');

    errorElement.classList.add('hidden');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memeriksa...';

    try {
      await API.login(username, password);

      state.currentPage = 'home';
      state.currentParams = {};

      updateNavigation();
      await renderCurrentPage();
      showToast('Login berhasil', 'success');
    } catch (error) {
      errorElement.textContent = error.message || 'Login gagal.';
      errorElement.classList.remove('hidden');
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Masuk';
    }
  }

  // [ADDED] Notifikasi toast singkat.
  function showToast(message, type = '') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');

    toast.className = `toast ${type}`;
    toast.textContent = String(message || 'Selesai');

    container.appendChild(toast);

    // [ADDED] Hapus toast setelah animasi selesai.
    window.setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  window.addEventListener('exgudang:toast', (event) => {
    showToast(event.detail?.message, event.detail?.type || '');
  });

  window.addEventListener('exgudang:unauthorized', () => {
    showToast('Sesi berakhir. Silakan login kembali.', 'error');
    renderLogin();
  });

  window.addEventListener('exgudang:logout', () => {
    state.currentPage = 'home';
    state.currentParams = {};
    renderLogin();
  });

  // [ADDED] Klik navigasi bawah.
  bottomNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button) return;

    window.ExGudangApp.navigate(button.dataset.page);
  });

  // [ADDED] Delegasi klik untuk aksi halaman.
  content.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');

    if (!button || button.disabled) return;

    const action = button.dataset.action;
    const id = button.dataset.id
      ? Number(button.dataset.id)
      : null;

    try {
      await Pages.handleAction(action, id, button);
    } catch (error) {
      showToast(error.message || 'Aksi gagal.', 'error');
    }
  });

  // [ADDED] Pencarian barang dengan jeda untuk mengurangi request.
  let searchTimer = null;

  content.addEventListener('input', (event) => {
    if (event.target.id !== 'item-search') return;

    const value = event.target.value;

    window.clearTimeout(searchTimer);

    searchTimer = window.setTimeout(() => {
      const scrollPosition = window.scrollY;

      // [ADDED] Simpan kata kunci sebelum daftar dimuat ulang.
      if (window.ExGudangPages.setItemSearch) {
        window.ExGudangPages.setItemSearch(value);
      }

      window.ExGudangApp.navigate('items').then(() => {
        window.scrollTo(0, scrollPosition);
      });
    }, 300);
  });

  // [ADDED] Tombol notifikasi untuk sementara menampilkan informasi.
  document.getElementById('notification-button')
    .addEventListener('click', () => {
      showToast('Pengecekan stok tersedia di halaman Beranda.', 'success');
    });

  // [ADDED] Mulai aplikasi.
  async function init() {
    updateNavigation();

    if (!API.isAuthenticated()) {
      renderLogin();
      return;
    }

    try {
      await API.getProfile();
      await renderCurrentPage();
    } catch {
      API.clearSession();
      renderLogin();
    }
  }

  init();
})();

