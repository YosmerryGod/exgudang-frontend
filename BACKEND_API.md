# Backend API Contract

Frontend mengharapkan backend HTTP JSON dengan base URL dari `VITE_API_URL` (default `/api`). Semua endpoint data, kecuali login, memerlukan header:

```http
Authorization: Bearer <token>
Accept: application/json
Content-Type: application/json
```

## Format respons

Respons sukses menggunakan bentuk:

```json
{ "success": true, "data": {} }
```

Respons gagal menggunakan bentuk:

```json
{ "success": false, "message": "Pesan kesalahan" }
```

Backend harus mengembalikan HTTP status yang sesuai. Untuk sesi tidak valid gunakan HTTP 401.

## Endpoint

| Method | Endpoint | Kegunaan |
|---|---|---|
| POST | `/auth/login` | Login; body `{ "username", "password" }`; data wajib berisi `token` dan `admin` |
| POST | `/auth/logout` | Logout / invalidasi sesi bila token disimpan di server |
| GET | `/auth/me` | Profil admin aktif |
| GET | `/dashboard` | Ringkasan stok, transaksi, peringatan, dan transaksi terbaru |
| GET | `/categories` | Daftar kategori |
| POST | `/categories` | Tambah kategori |
| PATCH | `/categories/:id` | Ubah kategori |
| DELETE | `/categories/:id` | Hapus kategori |
| GET | `/items` | Daftar barang; query opsional: `search`, `categoryId`, `stockStatus` |
| POST | `/items` | Tambah barang |
| GET | `/items/:id` | Detail barang |
| PATCH | `/items/:id` | Ubah barang |
| DELETE | `/items/:id` | Nonaktifkan barang |
| POST | `/items/:id/stock-in` | Catat stok masuk |
| POST | `/items/:id/stock-out` | Catat stok keluar |
| GET | `/items/:id/movements` | Riwayat barang; query: `limit`, `offset` |
| GET | `/reports/summary` | Ringkasan laporan stok |
| GET | `/reports/low-stock` | Daftar stok menipis/habis |
| GET | `/reports/movements` | Laporan transaksi; query: `startDate`, `endDate` |
| GET | `/movements/recent` | Transaksi terbaru; query: `limit` |

## Bentuk data yang dipakai UI

- Dashboard: `data.summary.stock`, `data.summary.monthly`, `data.summary.daily`, `data.recent_movements`, `data.stock_alerts`.
- Item dan kategori: daftar berada pada `data`; detail berada pada `data`.
- Movement report: `data.total_movements`, `data.total_in_quantity`, `data.total_out_quantity`, `data.total_in_cost_value`, `data.total_out_cost_value`, `data.total_outgoing_value`, `data.estimated_profit`.
- Riwayat dan daftar transaksi harus menyertakan properti yang dipakai UI, termasuk `item_name`, `item_code`, `unit`, `movement_type`, `quantity`, `occurred_at`, `cost_total`, dan `outgoing_total` sesuai konteks.

Kontrak ini adalah interface yang harus diimplementasikan backend. Belum ada URL backend atau endpoint server yang dikonfigurasi di repository frontend.
