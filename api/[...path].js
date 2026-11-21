'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

let pool;
let schemaReady;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum dikonfigurasi.');
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getPool();
      await db.query(\`
        CREATE TABLE IF NOT EXISTS admins (
          id BIGSERIAL PRIMARY KEY,
          username VARCHAR(100) NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS categories (
          id BIGSERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          description VARCHAR(500),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS items (
          id BIGSERIAL PRIMARY KEY,
          code VARCHAR(30) NOT NULL UNIQUE,
          name VARCHAR(150) NOT NULL,
          category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
          unit VARCHAR(30) NOT NULL,
          initial_stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (initial_stock >= 0),
          current_stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
          minimum_stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
          cost_price NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
          outgoing_price NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (outgoing_price >= 0),
          image_path TEXT,
          description TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS stock_movements (
          id BIGSERIAL PRIMARY KEY,
          item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
          movement_type VARCHAR(12) NOT NULL CHECK (movement_type IN ('IN','OUT','ADJUSTMENT')),
          quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
          unit_cost NUMERIC(16,2) NOT NULL DEFAULT 0,
          unit_outgoing_price NUMERIC(16,2) NOT NULL DEFAULT 0,
          cost_total NUMERIC(18,2) NOT NULL DEFAULT 0,
          outgoing_total NUMERIC(18,2) NOT NULL DEFAULT 0,
          stock_before NUMERIC(14,3) NOT NULL,
          stock_after NUMERIC(14,3) NOT NULL,
          supplier VARCHAR(150),
          destination VARCHAR(150),
          note VARCHAR(500),
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
        CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
        CREATE INDEX IF NOT EXISTS idx_items_active ON items(is_active);
        CREATE INDEX IF NOT EXISTS idx_movements_item_date ON stock_movements(item_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_movements_type_date ON stock_movements(movement_type, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_movements_date ON stock_movements(occurred_at DESC);
      \`);
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD;
      if (!password || password.length < 12) {
        throw new Error('ADMIN_PASSWORD wajib diatur minimal 12 karakter pada environment Vercel.');
      }
      const existing = await db.query('SELECT id FROM admins LIMIT 1');
      if (existing.rowCount === 0) {
        const hash = await bcrypt.hash(password, 12);
        await db.query(
          'INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING',
          [username, hash]
        );
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function send(res, status, payload) {
  res.status(status).json(payload);
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  throw error;
}

function getToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function authenticate(req) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET wajib diatur minimal 32 karakter.');
  try {
    const user = jwt.verify(getToken(req), secret);
    if (user.role !== 'admin' || !user.sub) fail('Sesi login tidak valid.', 401);
    return user;
  } catch (error) {
    if (error.statusCode) throw error;
    fail('Sesi login berakhir. Silakan login kembali.', 401);
  }
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function normalizeItem(row) {
  if (!row) return row;
  return {
    ...row,
    id: Number(row.id),
    category_id: row.category_id === null ? null : Number(row.category_id),
    initial_stock: number(row.initial_stock),
    current_stock: number(row.current_stock),
    minimum_stock: number(row.minimum_stock),
    cost_price: number(row.cost_price),
    outgoing_price: number(row.outgoing_price),
    is_active: Boolean(row.is_active),
    is_low_stock: number(row.current_stock) <= number(row.minimum_stock) ? 1 : 0,
    stock_cost_value: number(row.current_stock) * number(row.cost_price),
    stock_outgoing_value: number(row.current_stock) * number(row.outgoing_price)
  };
}

async function getItem(db, id, activeOnly = true) {
  const result = await db.query(
    \`SELECT i.*, c.name AS category_name
     FROM items i LEFT JOIN categories c ON c.id = i.category_id
     WHERE i.id = $1 \${activeOnly ? 'AND i.is_active = TRUE' : ''}\`,
    [id]
  );
  if (!result.rowCount) fail('Barang tidak ditemukan.', 404);
  return normalizeItem(result.rows[0]);
}

async function stockTransaction(db, itemId, data, type) {
  const quantity = number(data.quantity);
  if (!(quantity > 0)) fail('Jumlah transaksi harus lebih dari 0.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM items WHERE id=$1 AND is_active=TRUE FOR UPDATE', [itemId]);
    if (!found.rowCount) fail('Barang tidak ditemukan atau sudah dinonaktifkan.', 404);
    const item = found.rows[0];
    const before = number(item.current_stock);
    if (type === 'OUT' && quantity > before) fail(\`Stok tidak mencukupi. Stok tersedia: \${before}\`);
    const after = type === 'IN' ? before + quantity : before - quantity;
    const unitCost = type === 'IN' ? number(data.unit_cost ?? item.cost_price) : number(item.cost_price);
    const unitOut = number(data.unit_outgoing_price ?? item.outgoing_price);
    if (unitCost < 0 || unitOut < 0) fail('Harga tidak boleh negatif.');
    const costTotal = quantity * unitCost;
    const outgoingTotal = quantity * unitOut;
    const occurredAt = data.occurred_at || new Date().toISOString();
    let averageCost = number(item.cost_price);
    if (type === 'IN') {
      averageCost = after > 0 ? ((before * number(item.cost_price)) + (quantity * unitCost)) / after : unitCost;
      await client.query(
        'UPDATE items SET current_stock=$1,cost_price=$2,outgoing_price=$3,updated_at=NOW() WHERE id=$4',
        [after, averageCost, unitOut, itemId]
      );
    } else {
      await client.query('UPDATE items SET current_stock=$1,updated_at=NOW() WHERE id=$2', [after, itemId]);
    }
    const inserted = await client.query(
      \`INSERT INTO stock_movements
       (item_id,movement_type,quantity,unit_cost,unit_outgoing_price,cost_total,outgoing_total,stock_before,stock_after,supplier,destination,note,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id\`,
      [itemId,type,quantity,unitCost,unitOut,costTotal,outgoingTotal,before,after,
       type === 'IN' ? (data.supplier || null) : null,
       type === 'OUT' ? (data.destination || null) : null,
       data.note || (type === 'IN' ? 'Stok masuk' : 'Stok keluar'),occurredAt]
    );
    await client.query('COMMIT');
    return {
      movement_id: Number(inserted.rows[0].id), item_id: Number(itemId),
      item_code: item.code, item_name: item.name, movement_type: type,
      quantity, stock_before: before, stock_after: after, unit_cost: unitCost,
      average_cost_after: averageCost, unit_outgoing_price: unitOut,
      cost_total: costTotal, outgoing_total: outgoingTotal,
      estimated_profit: type === 'OUT' ? outgoingTotal - costTotal : 0,
      occurred_at: occurredAt
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function dashboard(db) {
  const stock = (await db.query(\`
    SELECT COUNT(*)::int AS total_items,
      COALESCE(SUM(current_stock),0) AS total_stock_units,
      COALESCE(SUM(current_stock*cost_price),0) AS total_stock_cost_value,
      COALESCE(SUM(current_stock*outgoing_price),0) AS total_stock_outgoing_value,
      COUNT(*) FILTER (WHERE current_stock <= minimum_stock)::int AS low_stock_items,
      COUNT(*) FILTER (WHERE current_stock = 0)::int AS empty_stock_items
    FROM items WHERE is_active=TRUE
  \`)).rows[0];
  const monthly = (await db.query(\`
    SELECT COUNT(*)::int AS total_movements,
      COALESCE(SUM(quantity) FILTER (WHERE movement_type='IN'),0) AS total_in_quantity,
      COALESCE(SUM(quantity) FILTER (WHERE movement_type='OUT'),0) AS total_out_quantity,
      COALESCE(SUM(outgoing_total) FILTER (WHERE movement_type='OUT'),0) AS total_outgoing_value,
      COALESCE(SUM(outgoing_total-cost_total) FILTER (WHERE movement_type='OUT'),0) AS estimated_profit
    FROM stock_movements WHERE occurred_at >= date_trunc('month',NOW())
  \`)).rows[0];
  const daily = (await db.query(\`
    SELECT COALESCE(SUM(quantity) FILTER (WHERE movement_type='IN'),0) AS total_in_quantity,
      COALESCE(SUM(quantity) FILTER (WHERE movement_type='OUT'),0) AS total_out_quantity
    FROM stock_movements WHERE occurred_at::date = CURRENT_DATE
  \`)).rows[0];
  const recent = await db.query(\`
    SELECT sm.*,i.code AS item_code,i.name AS item_name,i.unit
    FROM stock_movements sm JOIN items i ON i.id=sm.item_id
    ORDER BY sm.occurred_at DESC,sm.id DESC LIMIT 5
  \`);
  const alerts = await db.query(\`
    SELECT id,code,name,unit,current_stock,minimum_stock FROM items
    WHERE is_active=TRUE AND current_stock<=minimum_stock
    ORDER BY current_stock ASC,name ASC LIMIT 10
  \`);
  return {
    summary: {
      stock: Object.fromEntries(Object.entries(stock).map(([k,v]) => [k, number(v)])),
      monthly: Object.fromEntries(Object.entries(monthly).map(([k,v]) => [k, number(v)])),
      daily: Object.fromEntries(Object.entries(daily).map(([k,v]) => [k, number(v)]))
    },
    recent_movements: recent.rows,
    stock_alerts: alerts.rows.map(normalizeItem)
  };
}

async function handler(req, res) {
  try {
    await ensureSchema();
    const db = getPool();
    const url = new URL(req.url, 'https://exgudang.local');
    const path = url.pathname.replace(/^\\/api\\/?/, '').replace(/\\/$/, '');
    const parts = path.split('/').filter(Boolean);
    const method = req.method.toUpperCase();

    if (method === 'POST' && path === 'auth/login') {
      const { username, password } = req.body || {};
      if (!username || !password) fail('Username dan password wajib diisi.');
      const result = await db.query('SELECT id,username,password_hash FROM admins WHERE username=$1', [String(username).trim()]);
      if (!result.rowCount || !(await bcrypt.compare(String(password), result.rows[0].password_hash))) {
        fail('Username atau password salah.', 401);
      }
      const secret = process.env.JWT_SECRET;
      if (!secret || secret.length < 32) throw new Error('JWT_SECRET wajib diatur minimal 32 karakter.');
      const admin = { id: Number(result.rows[0].id), username: result.rows[0].username };
      const token = jwt.sign({ sub: String(admin.id), username: admin.username, role: 'admin' }, secret, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
      return send(res, 200, { success: true, message: 'Login berhasil', data: { admin, token, tokenType: 'Bearer', expiresIn: process.env.JWT_EXPIRES_IN || '1h' } });
    }

    const user = authenticate(req);

    if (method === 'GET' && path === 'auth/me') {
      const result = await db.query('SELECT id,username,created_at FROM admins WHERE id=$1', [Number(user.sub)]);
      if (!result.rowCount) fail('Akun admin tidak ditemukan.', 401);
      return send(res, 200, { success: true, data: result.rows[0] });
    }

    if (method === 'GET' && path === 'dashboard') {
      return send(res, 200, { success: true, data: await dashboard(db) });
    }

    if (parts[0] === 'categories') {
      if (method === 'GET' && parts.length === 1) {
        const result = await db.query(\`
          SELECT c.*,COUNT(i.id)::int AS item_count FROM categories c
          LEFT JOIN items i ON i.category_id=c.id GROUP BY c.id ORDER BY c.name ASC
        \`);
        return send(res, 200, { success: true, data: result.rows });
      }
      if (method === 'POST' && parts.length === 1) {
        const { name, description = null } = req.body || {};
        if (!String(name || '').trim()) fail('Nama kategori wajib diisi.');
        const result = await db.query('INSERT INTO categories(name,description) VALUES($1,$2) RETURNING *', [String(name).trim(),description]);
        return send(res, 201, { success: true, message: 'Kategori berhasil ditambahkan', data: result.rows[0] });
      }
      if (parts.length === 2 && method === 'PATCH') {
        const id = Number(parts[1]);
        const current = await db.query('SELECT * FROM categories WHERE id=$1', [id]);
        if (!current.rowCount) fail('Kategori tidak ditemukan.', 404);
        const name = req.body.name === undefined ? current.rows[0].name : String(req.body.name).trim();
        const description = req.body.description === undefined ? current.rows[0].description : req.body.description;
        const result = await db.query('UPDATE categories SET name=$1,description=$2,updated_at=NOW() WHERE id=$3 RETURNING *', [name,description,id]);
        return send(res, 200, { success: true, message: 'Kategori berhasil diperbarui', data: result.rows[0] });
      }
      if (parts.length === 2 && method === 'DELETE') {
        const id = Number(parts[1]);
        const used = await db.query('SELECT COUNT(*)::int AS total FROM items WHERE category_id=$1', [id]);
        if (number(used.rows[0].total)) fail('Kategori tidak dapat dihapus karena masih digunakan barang.', 409);
        const result = await db.query('DELETE FROM categories WHERE id=$1 RETURNING id', [id]);
        if (!result.rowCount) fail('Kategori tidak ditemukan.', 404);
        return send(res, 200, { success: true, message: 'Kategori berhasil dihapus' });
      }
    }

    if (parts[0] === 'items') {
      const id = Number(parts[1]);
      if (method === 'GET' && parts.length === 1) {
        const values = [];
        const conditions = ['i.is_active=TRUE'];
        if (url.searchParams.get('search')) {
          values.push('%' + url.searchParams.get('search') + '%');
          conditions.push('(i.name ILIKE $' + values.length + ' OR i.code ILIKE $' + values.length + ')');
        }
        if (url.searchParams.get('categoryId')) {
          values.push(Number(url.searchParams.get('categoryId')));
          conditions.push('i.category_id=$' + values.length);
        }
        const result = await db.query(\`
          SELECT i.*,c.name AS category_name FROM items i LEFT JOIN categories c ON c.id=i.category_id
          WHERE \${conditions.join(' AND ')} ORDER BY i.name ASC
        \`, values);
        return send(res, 200, { success: true, data: result.rows.map(normalizeItem), total: result.rowCount });
      }
      if (method === 'POST' && parts.length === 1) {
        const d = req.body || {};
        if (!String(d.name || '').trim() || !String(d.unit || '').trim()) fail('Nama dan satuan barang wajib diisi.');
        const initial = number(d.initial_stock), minimum = number(d.minimum_stock), cost = number(d.cost_price), outgoing = number(d.outgoing_price);
        if ([initial,minimum,cost,outgoing].some(v => v < 0)) fail('Nilai barang tidak boleh negatif.');
        if (d.category_id && !(await db.query('SELECT id FROM categories WHERE id=$1',[d.category_id])).rowCount) fail('Kategori tidak ditemukan.');
        const client = await db.connect();
        try {
          await client.query('BEGIN');
          const codeResult = await client.query("SELECT COALESCE(MAX(SUBSTRING(code FROM 5)::int),0)+1 AS next FROM items WHERE code ~ '^BRG-[0-9]+$'");
          const code = 'BRG-' + String(codeResult.rows[0].next).padStart(6,'0');
          const created = await client.query(\`
            INSERT INTO items(code,name,category_id,unit,initial_stock,current_stock,minimum_stock,cost_price,outgoing_price,description)
            VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9) RETURNING id
          \`,[code,String(d.name).trim(),d.category_id || null,String(d.unit).trim(),initial,minimum,cost,outgoing,d.description || null]);
          const newId = created.rows[0].id;
          if (initial > 0) {
            await client.query(\`
              INSERT INTO stock_movements(item_id,movement_type,quantity,unit_cost,unit_outgoing_price,cost_total,outgoing_total,stock_before,stock_after,note)
              VALUES($1,'IN',$2,$3,$4,$5,$6,0,$2,'Stok awal barang')
            \`,[newId,initial,cost,outgoing,initial*cost,initial*outgoing]);
          }
          await client.query('COMMIT');
          return send(res,201,{success:true,message:'Barang berhasil ditambahkan',data:await getItem(db,newId)});
        } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      }
      if (parts.length === 2 && method === 'GET') {
        return send(res,200,{success:true,data:await getItem(db,id)});
      }
      if (parts.length === 2 && method === 'PATCH') {
        const current = await getItem(db,id);
        const d = req.body || {};
        const fields = ['name','category_id','unit','minimum_stock','cost_price','outgoing_price','description'];
        const values = fields.map(key => d[key] === undefined ? current[key] : d[key]);
        const [name,categoryId,unit,min,cost,outgoing,description] = values;
        if (!String(name || '').trim() || !String(unit || '').trim() || [min,cost,outgoing].some(v => number(v)<0)) fail('Data barang tidak valid.');
        await db.query(\`
          UPDATE items SET name=$1,category_id=$2,unit=$3,minimum_stock=$4,cost_price=$5,outgoing_price=$6,description=$7,updated_at=NOW()
          WHERE id=$8 AND is_active=TRUE
        \`,[String(name).trim(),categoryId || null,String(unit).trim(),min,cost,outgoing,description,id]);
        return send(res,200,{success:true,message:'Informasi barang berhasil diperbarui',data:await getItem(db,id)});
      }
      if (parts.length === 2 && method === 'DELETE') {
        const item = await getItem(db,id);
        await db.query('UPDATE items SET is_active=FALSE,updated_at=NOW() WHERE id=$1',[id]);
        return send(res,200,{success:true,message:'Barang berhasil dinonaktifkan',data:{id:item.id,code:item.code,name:item.name}});
      }
      if (parts.length === 3 && parts[2] === 'stock-in' && method === 'POST') {
        return send(res,201,{success:true,message:'Stok masuk berhasil dicatat',data:await stockTransaction(db,id,req.body || {},'IN')});
      }
      if (parts.length === 3 && parts[2] === 'stock-out' && method === 'POST') {
        return send(res,201,{success:true,message:'Stok keluar berhasil dicatat',data:await stockTransaction(db,id,req.body || {},'OUT')});
      }
      if (parts.length === 3 && parts[2] === 'movements' && method === 'GET') {
        const limit = Math.min(200,Math.max(1,Number(url.searchParams.get('limit') || 50)));
        const offset = Math.max(0,Number(url.searchParams.get('offset') || 0));
        const result = await db.query('SELECT * FROM stock_movements WHERE item_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT $2 OFFSET $3',[id,limit,offset]);
        return send(res,200,{success:true,data:result.rows,total:result.rowCount,limit,offset});
      }
    }

    if (parts[0] === 'reports') {
      if (method === 'GET' && parts[1] === 'summary') {
        const result = await db.query(\`
          SELECT COUNT(*)::int AS total_items,
            COALESCE(SUM(current_stock*cost_price),0) AS total_stock_cost_value,
            COALESCE(SUM(current_stock*outgoing_price),0) AS total_stock_outgoing_value
          FROM items WHERE is_active=TRUE
        \`);
        const data = result.rows[0];
        data.estimated_stock_margin = number(data.total_stock_outgoing_value)-number(data.total_stock_cost_value);
        return send(res,200,{success:true,data});
      }
      if (method === 'GET' && parts[1] === 'low-stock') {
        const result = await db.query('SELECT * FROM items WHERE is_active=TRUE AND current_stock<=minimum_stock ORDER BY current_stock ASC,name ASC');
        return send(res,200,{success:true,data:result.rows.map(normalizeItem),total:result.rowCount});
      }
      if (method === 'GET' && parts[1] === 'recent-movements') {
        const limit = Math.min(100,Math.max(1,Number(url.searchParams.get('limit') || 20)));
        const result = await db.query(\`
          SELECT sm.*,i.code AS item_code,i.name AS item_name,i.unit
          FROM stock_movements sm JOIN items i ON i.id=sm.item_id
          ORDER BY sm.occurred_at DESC,sm.id DESC LIMIT $1
        \`,[limit]);
        return send(res,200,{success:true,data:result.rows,total:result.rowCount});
      }
      if (method === 'GET' && parts[1] === 'movements') {
        const start = url.searchParams.get('startDate');
        const end = url.searchParams.get('endDate');
        if (start && !/^\\d{4}-\\d{2}-\\d{2}$/.test(start)) fail('Format startDate tidak valid.');
        if (end && !/^\\d{4}-\\d{2}-\\d{2}$/.test(end)) fail('Format endDate tidak valid.');
        if (start && end && start > end) fail('startDate tidak boleh melewati endDate.');
        const values = [], conditions = [];
        if (start) { values.push(start); conditions.push('occurred_at::date >= $'+values.length+'::date'); }
        if (end) { values.push(end); conditions.push('occurred_at::date <= $'+values.length+'::date'); }
        const result = await db.query(\`
          SELECT COUNT(*)::int AS total_movements,
            COALESCE(SUM(quantity) FILTER(WHERE movement_type='IN'),0) AS total_in_quantity,
            COALESCE(SUM(quantity) FILTER(WHERE movement_type='OUT'),0) AS total_out_quantity,
            COALESCE(SUM(cost_total) FILTER(WHERE movement_type='IN'),0) AS total_in_cost_value,
            COALESCE(SUM(cost_total) FILTER(WHERE movement_type='OUT'),0) AS total_out_cost_value,
            COALESCE(SUM(outgoing_total) FILTER(WHERE movement_type='OUT'),0) AS total_outgoing_value,
            COALESCE(SUM(outgoing_total-cost_total) FILTER(WHERE movement_type='OUT'),0) AS estimated_profit
          FROM stock_movements \${conditions.length ? 'WHERE '+conditions.join(' AND ') : ''}
        \`,values);
        return send(res,200,{success:true,period:{startDate:start,endDate:end},data:result.rows[0]});
      }
    }

    return send(res,404,{success:false,message:'Endpoint tidak ditemukan.'});
  } catch (error) {
    const status = error.statusCode || (error.code === '23505' ? 409 : 500);
    if (status >= 500) console.error('[ExGudang API]',error);
    return send(res,status,{success:false,message:status >= 500 ? 'Terjadi kesalahan pada server.' : error.message});
  }
}

module.exports = handler;
