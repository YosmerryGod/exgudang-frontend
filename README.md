# ExGudang Frontend

Frontend aplikasi manajemen stok ExGudang.

## Development

```bash
npm install
npm run dev
```

## Backend

Frontend ini tidak menyimpan atau mengakses database secara langsung. Seluruh autentikasi, data barang, kategori, transaksi stok, dan laporan diproses oleh backend melalui HTTP API.

Atur `VITE_API_URL` pada environment deployment. Nilai default adalah `/api`, sehingga frontend mengakses backend pada domain yang sama. Untuk backend pada domain berbeda, isi dengan base URL backend lengkap.

Kontrak endpoint dan format respons tersedia di [BACKEND_API.md](./BACKEND_API.md).
