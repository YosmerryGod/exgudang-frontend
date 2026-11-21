# ExGudang — Neon PostgreSQL

## Environment variables

Atur variabel berikut pada Vercel Project Settings → Environment Variables:

- `POSTGRES_URL`: pooled connection string dari Neon (sama seperti konfigurasi Xkalkultor). Aktifkan SSL.
- `JWT_SECRET`: secret acak minimal 32 karakter.
- `ADMIN_USERNAME`: username admin awal, default `admin`.
- `ADMIN_PASSWORD`: password admin awal, minimal 10 karakter.

Jangan commit file `.env` atau connection string Neon ke GitHub.

## Database

API serverless akan membuat tabel dan index yang dibutuhkan secara otomatis pada request pertama. Database dimulai kosong; akun admin awal dibuat dari environment variables. Tidak ada data barang, kategori, atau transaksi contoh yang dimasukkan.

## Deployment

1. Hubungkan repository ini ke Vercel.
2. Tambahkan environment variables di atas untuk Production (dan Preview jika diperlukan).
3. Deploy branch yang berisi perubahan ini.
4. Buka aplikasi dan login menggunakan akun admin yang dikonfigurasi.

Frontend memanggil endpoint relatif `/api` pada domain yang sama. Tidak ada lagi request ke `apigudang.doodweb.tech`.

## Catatan keamanan

Password admin disimpan sebagai bcrypt hash di Neon. Token login ditandatangani dengan `JWT_SECRET`. Jangan membagikan `POSTGRES_URL` atau `JWT_SECRET`.
