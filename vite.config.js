import { defineConfig } from 'vite';

// [MODIFIED] Izinkan API_URL diekspos karena hanya berisi alamat endpoint publik.
export default defineConfig({
  envPrefix: ['VITE_', 'API_URL']
});
