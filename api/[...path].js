'use strict';

const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

let db;
let schemaReady;

function getDb() {
  if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL belum dikonfigurasi.');
  if (!process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_AUTH_TOKEN belum dikonfigurasi.');
  if (!db) db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
  return db;
}

async function execute(sql, args = []) {
  return getDb().execute({ sql, args });
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = getDb();
      const schema = [
        \`CREATE TABLE IF NOT EXISTS admins (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )\`,
        \`CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )\`,
        \`CREATE TABLE IF NOT EXISTS items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          unit TEXT NOT NULL,
          initial_stock REAL NOT NULL DEFAULT 0 CHECK(initial_stock >= 0),
          current_stock REAL NOT NULL DEFAULT 0 CHECK(current_stock >= 0),
          minimum_stock REAL NOT NULL DEFAULT 0 CHECK(minimum_stock >= 0),
          cost_price REAL NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
          outgoing_price REAL NOT NULL DEFAULT 0 CHECK(outgoing_price >= 0),
          image_path TEXT,
          description TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )\`,
        \`CREATE TABLE IF NOT EXISTS stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
          movement_type TEXT NOT NULL CHECK(movement_type IN ('IN','OUT','ADJUSTMENT')),
          quantity REAL NOT NULL CHECK(quantity > 0),
          unit_cost REAL NOT NULL DEFAULT 0,
          unit_outgoing_price REAL NOT NULL DEFAULT 0,
          cost_total REAL NOT NULL DEFAULT 0,
          outgoing_total REAL NOT NULL DEFAULT 0,
          stock_before REAL NOT NULL,
          stock_after REAL NOT NULL,
          supplier TEXT,
          destination TEXT,
          note TEXT,
          occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )\`,
        'CREATE INDEX IF NOT EXISTS idx_items_name ON items(name)',
        'CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id)',
        'CREATE INDEX IF NOT EXISTS idx_items_active ON items(is_active)',
        'CREATE INDEX IF NOT EXISTS idx_movements_item_date ON stock_movements(item_id, occurred_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_movements_type_date ON stock_movements(movement_type, occurred_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_movements_date ON stock_movements(occurred_at DESC)'
      ];
      for (const sql of schema) await client.execute(sql);

      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD;
      if (!password || password.length < 10) {
        throw new Error('ADMIN_PASSWORD wajib diatur minimal 10 karakter pada environment Vercel.');
      }
      const existing = await client.execute('SELECT id FROM admins LIMIT 1');
      if (existing.rows.length === 0) {
        const hash = await bcrypt.hash(password, 12);
        await client.execute({
          sql: 'INSERT OR IGNORE INTO admins(username,password_hash) VALUES(?,?)',
          args: [username, hash]
        });
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  throw error;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function rows(result) {
  return result.rows.map((row) => ({ ...row }));
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

function normalizeItem(row) {
  if (!row) return row;
  return {
    ...row,
    id: Number(row.id),
    category_id: row.category_id == null ? null : Number(row.category_id),
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

async function getItem(id, activeOnly = true) {
  const result = await execute(
    \`SELECT i.*,c.name AS category_name FROM items i
     LEFT JOIN categories c ON c.id=i.category_id
     WHERE i.id=? \${activeOnly ? 'AND i.is_active=1' : ''}\`,
    [id]
  );
  if (!result.rows.length) fail('Barang tidak ditemukan.', 404);
  return normalizeItem({ ...result.rows[0] });
}

async function stockTransaction(itemId, data, type) {
  const quantity = number(data.quantity);
  if (!(quantity > 0)) fail('Jumlah transaksi harus lebih dari 0.');
  const tx = await getDb().transaction('write');
  try {
    const found = await tx.execute({
      sql: 'SELECT * FROM items WHERE id=? AND is_active=1',
      args: [itemId]
    });
    if (!found.rows.length) fail('Barang tidak ditemukan atau sudah dinonaktifkan.', 404);
    const item = { ...found.rows[0] };
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
      averageCost = after > 0
        ? ((before * number(item.cost_price)) + (quantity * unitCost)) / after
        : unitCost;
      await tx.execute({
        sql: 'UPDATE items SET current_stock=?,cost_price=?,outgoing_price=?,updated_at=? WHERE id=?',
        args: [after, averageCost, unitOut, occurredAt, itemId]
      });
    } else {
      await tx.execute({
        sql: 'UPDATE items SET current_stock=?,updated_at=? WHERE id=?',
        args: [after, occurredAt, itemId]
      });
    }

    const inserted = await tx.execute({
      sql: \`INSERT INTO stock_movements
        (item_id,movement_type,quantity,unit_cost,unit_outgoing_price,cost_total,outgoing_total,
         stock_before,stock_after,supplier,destination,note,occurred_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)\`,
      args: [
        itemId, type, quantity, unitCost, unitOut, costTotal, outgoingTotal,
        before, after, type === 'IN' ? (data.supplier || null) : null,
        type === 'OUT' ? (data.destination || null) : null,
        data.note || (type === 'IN' ? 'Stok masuk' : 'Stok keluar'), occurredAt
      ]
    });
    await tx.commit();
    return {
      movement_id: Number(inserted.lastInsertRowid),
      item_id: Number(itemId),
      item_code: item.code,
      item_name: item.name,
      movement_type: type,
      quantity,
      stock_before: before,
      stock_after: after,
      unit_cost: unitCost,
      average_cost_after: averageCost,
      unit_outgoing_price: unitOut,
      cost_total: costTotal,
      outgoing_total: outgoingTotal,
      estimated_profit: type === 'OUT' ? outgoingTotal - costTotal : 0,
      occurred_at: occurredAt
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

async function dashboard() {
  const stock = (await execute(\`
    SELECT COUNT(*) AS total_items,
      COALESCE(SUM(current_stock),0) AS total_stock_units,
      COALESCE(SUM(current_stock*cost_price),0) AS total_stock_cost_value,
      COALESCE(SUM(current_stock*outgoing_price),0) AS total_stock_outgoing_value,
      SUM(CASE WHEN current_stock<=minimum_stock THEN 1 ELSE 0 END) AS low_stock_items,
      SUM(CASE WHEN current_stock=0 THEN 1 ELSE 0 END) AS empty_stock_items
    FROM items WHERE is_active=1
  \`)).rows[0];
  const monthly = (await execute(\`
    SELECT COUNT(*) AS total_movements,
      COALESCE(SUM(CASE WHEN movement_type='IN' THEN quantity ELSE 0 END),0) AS total_in_quantity,
      COALESCE(SUM(CASE WHEN movement_type='OUT' THEN quantity ELSE 0 END),0) AS total_out_quantity,
      COALESCE(SUM(CASE WHEN movement_type='OUT' THEN outgoing_total ELSE 0 END),0) AS total_outgoing_value,
      COALESCE(SUM(CASE WHEN movement_type='OUT' THEN outgoing_total-cost_total ELSE 0 END),0) AS estimated_profit
    FROM stock_movements
    WHERE strftime('%Y-%m',occurred_at)=strftime('%Y-%m','now')
  \`)).rows[0];
  const daily = (await execute(\`
    SELECT COALESCE(SUM(CASE WHEN movement_type='IN' THEN quantity ELSE 0 END),0) AS total_in_quantity,
      COALESCE(SUM(CASE WHEN movement_type='OUT' THEN quantity ELSE 0 END),0) AS total_out_quantity
    FROM stock_movements WHERE date(occurred_at)=date('now')
  \`)).rows[0];
  const recent = await execute(\`
    SELECT sm.*,i.code AS item_code,i.name AS item_name,i.unit
    FROM stock_movements sm JOIN items i ON i.id=sm.item_id
    ORDER BY sm.occurred_at DESC,sm.id DESC LIMIT 5
  \`);
  const alerts = await execute(\`
    SELECT id,code,name,unit,current_stock,minimum_stock FROM items
    WHERE is_active=1 AND current_stock<=minimum_stock
    ORDER BY current_stock ASC,name ASC LIMIT 10
  \`);
  return {
    summary: {
      stock: Object.fromEntries(Object.entries(stock).map(([key,value]) => [key,number(value)])),
      monthly: Object.fromEntries(Object.entries(monthly).map(([key,value]) => [key,number(value)])),
      daily: Object.fromEntries(Object.entries(daily).map(([key,value]) => [key,number(value)]))
    },
    recent_movements: rows(recent),
    stock_alerts: rows(alerts).map(normalizeItem)
  };
}

async function handler(req, res) {
  try {
    await ensureSchema();
    const url = new URL(req.url, 'https://exgudang.local');
    const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
    const parts = path.split('/').filter(Boolean);
    const method = req.method.toUpperCase();

    if (method === 'POST' && path === 'auth/login') {
      const { username, password } = req.body || {};
      if (!username || !password) fail('Username dan password wajib diisi.');
      const result = await execute(
        'SELECT id,username,password_hash FROM admins WHERE username=?',
        [String(username).trim()]
      );
      if (!result.rows.length || !(await bcrypt.compare(String(password), result.rows[0].password_hash))) {
        fail('Username atau password salah.', 401);
      }
      const secret = process.env.JWT_SECRET;
      if (!secret || secret.length < 32) throw new Error('JWT_SECRET wajib diatur minimal 32 karakter.');
      const admin = { id: Number(result.rows[0].id), username: result.rows[0].username };
      const expiresIn = process.env.JWT_EXPIRES_IN || '1h';
      const token = jwt.sign({ sub: String(admin.id), username: admin.username, role: 'admin' }, secret, { expiresIn });
      return send(res, 200, {
        success: true,
        message: 'Login berhasil',
        data: { admin, token, tokenType: 'Bearer', expiresIn }
      });
    }

    const user = authenticate(req);

    if (method === 'GET' && path === 'auth/me') {
      const result = await execute(
        'SELECT id,username,created_at FROM admins WHERE id=?',
        [Number(user.sub)]
      );
      if (!result.rows.length) fail('Akun admin tidak ditemukan.', 401);
      return send(res, 200, { success: true, data: { ...result.rows[0] } });
    }

    if (method === 'GET' && path === 'dashboard') {
      return send(res, 200, { success: true, data: await dashboard() });
    }

    if (parts[0] === 'categories') {
      if (method === 'GET' && parts.length === 1) {
        const result = await execute(\`
          SELECT c.*,COUNT(i.id) AS item_count FROM categories c
          LEFT JOIN items i ON i.category_id=c.id
          GROUP BY c.id ORDER BY c.name ASC
        \`);
        return send(res, 200, { success: true, data: rows(result) });
      }
      if (method === 'POST' && parts.length === 1) {
        const { name, description = null } = req.body || {};
        if (!String(name || '').trim()) fail('Nama kategori wajib diisi.');
        const result = await execute(
          'INSERT INTO categories(name,description) VALUES(?,?)',
          [String(name).trim(), description]
        );
        const created = await execute('SELECT * FROM categories WHERE id=?', [Number(result.lastInsertRowid)]);
        return send(res, 201, { success: true, message: 'Kategori berhasil ditambahkan', data: { ...created.rows[0] } });
      }
      if (parts.length === 2 && method === 'PATCH') {
        const id = Number(parts[1]);
        const current = await execute('SELECT * FROM categories WHERE id=?', [id]);
        if (!current.rows.length) fail('Kategori tidak ditemukan.', 404);
        const name = req.body.name === undefined ? current.rows[0].name : String(req.body.name).trim();
        const description = req.body.description === undefined ? current.rows[0].description : req.body.description;
        if (!name) fail('Nama kategori wajib diisi.');
        await execute(
          'UPDATE categories SET name=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
          [name, description, id]
        );
        const updated = await execute('SELECT * FROM categories WHERE id=?', [id]);
        return send(res, 200, { success: true, message: 'Kategori berhasil diperbarui', data: { ...updated.rows[0] } });
      }
      if (parts.length === 2 && method === 'DELETE') {
        const id = Number(parts[1]);
        const used = await execute('SELECT COUNT(*) AS total FROM items WHERE category_id=?', [id]);
        if (number(used.rows[0].total)) fail('Kategori tidak dapat dihapus karena masih digunakan barang.', 409);
        const result = await execute('DELETE FROM categories WHERE id=?', [id]);
        if (!result.rowsAffected) fail('Kategori tidak ditemukan.', 404);
        return send(res, 200, { success: true, message: 'Kategori berhasil dihapus' });
      }
    }

    if (parts[0] === 'items') {
      const id = Number(parts[1]);
      if (method === 'GET' && parts.length === 1) {
        const conditions = ['i.is_active=1'];
        const args = [];
        if (url.searchParams.get('search')) {
          args.push('%' + url.searchParams.get('search') + '%');
          conditions.push('(i.name LIKE ? COLLATE NOCASE OR i.code LIKE ? COLLATE NOCASE)');
          args.push(args[args.length - 1]);
        }
        if (url.searchParams.get('categoryId')) {
          conditions.push('i.category_id=?');
          args.push(Number(url.searchParams.get('categoryId')));
        }
        const stockStatus = url.searchParams.get('stockStatus');
        if (stockStatus === 'low') conditions.push('i.current_stock>0 AND i.current_stock<=i.minimum_stock');
        if (stockStatus === 'available') conditions.push('i.current_stock>i.minimum_stock');
        if (stockStatus === 'empty') conditions.push('i.current_stock=0');
        const result = await execute(\`
          SELECT i.*,c.name AS category_name FROM items i
          LEFT JOIN categories c ON c.id=i.category_id
          WHERE \${conditions.join(' AND ')} ORDER BY i.name ASC
        \`, args);
        return send(res, 200, { success: true, data: rows(result).map(normalizeItem), total: result.rows.length });
      }
      if (method === 'POST' && parts.length === 1) {
        const d = req.body || {};
        if (!String(d.name || '').trim() || !String(d.unit || '').trim()) fail('Nama dan satuan barang wajib diisi.');
        const initial = number(d.initial_stock);
        const minimum = number(d.minimum_stock);
        const cost = number(d.cost_price);
        const outgoing = number(d.outgoing_price);
        if ([initial,minimum,cost,outgoing].some(value => value < 0)) fail('Nilai barang tidak boleh negatif.');
        if (d.category_id && !(await execute('SELECT id FROM categories WHERE id=?',[d.category_id])).rows.length) fail('Kategori tidak ditemukan.');
        const tx = await getDb().transaction('write');
        try {
          const codeResult = await tx.execute("SELECT COALESCE(MAX(CAST(SUBSTR(code,5) AS INTEGER)),0)+1 AS next FROM items WHERE code GLOB 'BRG-[0-9]*'");
          const code = 'BRG-' + String(codeResult.rows[0].next).padStart(6,'0');
          const created = await tx.execute({
            sql: \`INSERT INTO items(code,name,category_id,unit,initial_stock,current_stock,minimum_stock,cost_price,outgoing_price,description)
              VALUES(?,?,?,?,?,?,?,?,?,?)\`,
            args: [code,String(d.name).trim(),d.category_id || null,String(d.unit).trim(),initial,initial,minimum,cost,outgoing,d.description || null]
          });
          const newId = Number(created.lastInsertRowid);
          if (initial > 0) {
            await tx.execute({
              sql: \`INSERT INTO stock_movements
                (item_id,movement_type,quantity,unit_cost,unit_outgoing_price,cost_total,outgoing_total,stock_before,stock_after,note)
                VALUES(?,'IN',?,?,?,?,?,0,?,'Stok awal barang')\`,
              args: [newId,initial,cost,outgoing,initial*cost,initial*outgoing,initial]
            });
          }
          await tx.commit();
          return send(res,201,{success:true,message:'Barang berhasil ditambahkan',data:await getItem(newId)});
        } catch (error) {
          await tx.rollback();
          throw error;
        } finally {
          tx.close();
        }
      }
      if (parts.length === 2 && method === 'GET') {
        return send(res,200,{success:true,data:await getItem(id)});
      }
      if (parts.length === 2 && method === 'PATCH') {
        const current = await getItem(id);
        const d = req.body || {};
        const fields = ['name','category_id','unit','minimum_stock','cost_price','outgoing_price','description'];
        const values = fields.map(key => d[key] === undefined ? current[key] : d[key]);
        const [name,categoryId,unit,min,cost,outgoing,description] = values;
        if (!String(name || '').trim() || !String(unit || '').trim() || [min,cost,outgoing].some(value => number(value)<0)) fail('Data barang tidak valid.');
        if (categoryId && !(await execute('SELECT id FROM categories WHERE id=?',[categoryId])).rows.length) fail('Kategori tidak ditemukan.');
        await execute(\`
          UPDATE items SET name=?,category_id=?,unit=?,minimum_stock=?,cost_price=?,outgoing_price=?,description=?,updated_at=datetime('now')
          WHERE id=? AND is_active=1
        \`,[String(name).trim(),categoryId || null,String(unit).trim(),number(min),number(cost),number(outgoing),description,id]);
        return send(res,200,{success:true,message:'Informasi barang berhasil diperbarui',data:await getItem(id)});
      }
      if (parts.length === 2 && method === 'DELETE') {
        const item = await getItem(id);
        await execute("UPDATE items SET is_active=0,updated_at=datetime('now') WHERE id=?",[id]);
        return send(res,200,{success:true,message:'Barang berhasil dinonaktifkan',data:{id:item.id,code:item.code,name:item.name}});
      }
      if (parts.length === 3 && parts[2] === 'stock-in' && method === 'POST') {
        return send(res,201,{success:true,message:'Stok masuk berhasil dicatat',data:await stockTransaction(id,req.body || {},'IN')});
      }
      if (parts.length === 3 && parts[2] === 'stock-out' && method === 'POST') {
        return send(res,201,{success:true,message:'Stok keluar berhasil dicatat',data:await stockTransaction(id,req.body || {},'OUT')});
      }
      if (parts.length === 3 && parts[2] === 'movements' && method === 'GET') {
        const limit = Math.min(200,Math.max(1,Number(url.searchParams.get('limit') || 50)));
        const offset = Math.max(0,Number(url.searchParams.get('offset') || 0));
        const result = await execute(
          'SELECT * FROM stock_movements WHERE item_id=? ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?',
          [id,limit,offset]
        );
        const count = await execute('SELECT COUNT(*) AS total FROM stock_movements WHERE item_id=?',[id]);
        return send(res,200,{success:true,data:rows(result),total:number(count.rows[0].total),limit,offset});
      }
    }

    if (parts[0] === 'reports') {
      if (method === 'GET' && parts[1] === 'summary') {
        const result = await execute(\`
          SELECT COUNT(*) AS total_items,
            COALESCE(SUM(current_stock*cost_price),0) AS total_stock_cost_value,
            COALESCE(SUM(current_stock*outgoing_price),0) AS total_stock_outgoing_value
          FROM items WHERE is_active=1
        \`);
        const data = { ...result.rows[0] };
        data.estimated_stock_margin = number(data.total_stock_outgoing_value)-number(data.total_stock_cost_value);
        return send(res,200,{success:true,data});
      }
      if (method === 'GET' && parts[1] === 'low-stock') {
        const result = await execute('SELECT * FROM items WHERE is_active=1 AND current_stock<=minimum_stock ORDER BY current_stock ASC,name ASC');
        return send(res,200,{success:true,data:rows(result).map(normalizeItem),total:result.rows.length});
      }
      if (method === 'GET' && parts[1] === 'recent-movements') {
        const limit = Math.min(100,Math.max(1,Number(url.searchParams.get('limit') || 20)));
        const result = await execute(\`
          SELECT sm.*,i.code AS item_code,i.name AS item_name,i.unit
          FROM stock_movements sm JOIN items i ON i.id=sm.item_id
          ORDER BY sm.occurred_at DESC,sm.id DESC LIMIT ?
        \`,[limit]);
        return send(res,200,{success:true,data:rows(result),total:result.rows.length});
      }
      if (method === 'GET' && parts[1] === 'movements') {
        const start = url.searchParams.get('startDate');
        const end = url.searchParams.get('endDate');
        if (start && !/^\\d{4}-\\d{2}-\\d{2}$/.test(start)) fail('Format startDate tidak valid.');
        if (end && !/^\\d{4}-\\d{2}-\\d{2}$/.test(end)) fail('Format endDate tidak valid.');
        if (start && end && start > end) fail('startDate tidak boleh melewati endDate.');
        const conditions = [];
        const args = [];
        if (start) { conditions.push('date(occurred_at)>=date(?)'); args.push(start); }
        if (end) { conditions.push('date(occurred_at)<=date(?)'); args.push(end); }
        const result = await execute(\`
          SELECT COUNT(*) AS total_movements,
            COALESCE(SUM(CASE WHEN movement_type='IN' THEN quantity ELSE 0 END),0) AS total_in_quantity,
            COALESCE(SUM(CASE WHEN movement_type='OUT' THEN quantity ELSE 0 END),0) AS total_out_quantity,
            COALESCE(SUM(CASE WHEN movement_type='IN' THEN cost_total ELSE 0 END),0) AS total_in_cost_value,
            COALESCE(SUM(CASE WHEN movement_type='OUT' THEN cost_total ELSE 0 END),0) AS total_out_cost_value,
            COALESCE(SUM(CASE WHEN movement_type='OUT' THEN outgoing_total ELSE 0 END),0) AS total_outgoing_value,
            COALESCE(SUM(CASE WHEN movement_type='OUT' THEN outgoing_total-cost_total ELSE 0 END),0) AS estimated_profit
          FROM stock_movements \${conditions.length ? 'WHERE '+conditions.join(' AND ') : ''}
        \`,args);
        return send(res,200,{success:true,period:{startDate:start,endDate:end},data:{...result.rows[0]}});
      }
    }

    return send(res,404,{success:false,message:'Endpoint tidak ditemukan.'});
  } catch (error) {
    const status = error.statusCode || (error.code === 'SQLITE_CONSTRAINT' ? 409 : 500);
    if (status >= 500) console.error('[ExGudang API]',error);
    return send(res,status,{
      success:false,
      message:status >= 500 ? 'Terjadi kesalahan pada server.' : error.message,
      // [ADDED] Tampilkan detail error teknis di aplikasi agar mudah didiagnosis.
      detail:status >= 500 ? (error.message || 'Tidak ada detail error dari server.') : undefined,
      errorCode:status >= 500 ? (error.code || error.name || 'SERVER_ERROR') : undefined
    });
  }
}

module.exports = handler;
