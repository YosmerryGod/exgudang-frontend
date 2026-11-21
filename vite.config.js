import { defineConfig } from 'vite';

// [MODIFIED] Hanya variabel VITE_ yang boleh diekspos ke browser.
export default defineConfig({
  envPrefix: ['VITE_']
});
