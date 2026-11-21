# ExGudang — Turso (SQLite)

## Environment variables

Atur variabel berikut pada Vercel Project Settings → Environment Variables:

- `TURSO_DATABASE_URL`: URL database Turso, diawali `libsql://`.
- `TURSO_AUTH_TOKEN`: database auth token dari Turso.
- `JWT_SECRET`: secret acak minimal 32 karakter.
- `ADMIN_USERNAME`: username admin awal, default `admin`.
- `ADMIN_PASSWORD`: password admin awal, minimal 10 karakter.

Jangan commit file `.env`, database auth token, atau JWT secret ke GitHub.

## Database

API menggunakan `@libsql/client` dan Turso (SQLite-compatible). Tabel dan index dibuat otomatis saat request API pertama. Database dimulai kosong; akun admin awal dibuat dari environment variables. Tidak ada data barang, kategori, atau transaksi contoh yang dimasukkan.

## Deployment

1. Hubungkan repository ini ke Vercel.
2. Tambahkan environment variables di atas untuk Production (dan Preview jika diperlukan).
3. Deploy branch yang berisi perubahan ini.
4. Buka aplikasi dan login menggunakan akun admin yang dikonfigurasi.

Frontend memanggil endpoint relatif `/api` pada domain yang sama. Tidak ada lagi request ke backend VPS terpisah.

## Catatan keamanan

Password admin disimpan sebagai bcrypt hash di Turso. Token login ditandatangani dengan `JWT_SECRET`. Jangan membagikan `TURSO_AUTH_TOKEN` atau `JWT_SECRET`.
