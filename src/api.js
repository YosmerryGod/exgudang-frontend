import { createClient } from '@libsql/client/web';
import bcrypt from 'bcryptjs';

const url = import.meta.env.TURSO_DATABASE_URL || import.meta.env.VITE_TURSO_DATABASE_URL;
const authToken = import.meta.env.TURSO_AUTH_TOKEN || import.meta.env.VITE_TURSO_AUTH_TOKEN;
if (!url || !authToken) console.error('TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN wajib tersedia saat build.');
const db = createClient({ url: url || '', authToken: authToken || '' });
const TOKEN_KEY = 'exgudang_token';
const ADMIN_KEY = 'exgudang_admin';
let schemaReady;

const num = (v) => Number(v || 0);
const rows = (r) => r.rows.map((x) => ({ ...x }));
const fail = (message, status = 400) => { const e = new Error(message); e.statusCode = status; throw e; };
const ok = (data, extra = {}) => ({ success: true, data, ...extra });
const exec = (sql, args = []) => db.execute({ sql, args });
const enc = encodeURIComponent;

async function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
    await exec("CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)");
    await exec("CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)");
    await exec("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category_id INTEGER, unit TEXT NOT NULL, initial_stock REAL DEFAULT 0, current_stock REAL DEFAULT 0, minimum_stock REAL DEFAULT 0, cost_price REAL DEFAULT 0, outgoing_price REAL DEFAULT 0, image_path TEXT, description TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)");
    await exec("CREATE TABLE IF NOT EXISTS stock_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, movement_type TEXT NOT NULL, quantity REAL NOT NULL, unit_cost REAL DEFAULT 0, unit_outgoing_price REAL DEFAULT 0, cost_total REAL DEFAULT 0, outgoing_total REAL DEFAULT 0, stock_before REAL DEFAULT 0, stock_after REAL DEFAULT 0, supplier TEXT, destination TEXT, note TEXT, occurred_at TEXT DEFAULT CURRENT_TIMESTAMP, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
    await exec("CREATE INDEX IF NOT EXISTS idx_items_name ON items(name)");
    await exec("CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id)");
    await exec("CREATE INDEX IF NOT EXISTS idx_items_active ON items(is_active)");
    await exec("CREATE INDEX IF NOT EXISTS idx_movements_item_date ON stock_movements(item_id, occurred_at)");
    await exec("CREATE INDEX IF NOT EXISTS idx_movements_type_date ON stock_movements(movement_type, occurred_at)");
    await exec("CREATE INDEX IF NOT EXISTS idx_movements_date ON stock_movements(occurred_at)");
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}
function getAdmin() { try { return JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null'); } catch { return null; } }
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(ADMIN_KEY); }
function isAuthenticated() { return Boolean(getToken() && getAdmin()); }
function requireAuth() { if (!isAuthenticated()) fail('Silakan login kembali.', 401); }
function normalizeItem(item) {
  return { ...item, id: num(item.id), category_id: item.category_id == null ? null : num(item.category_id), initial_stock: num(item.initial_stock), current_stock: num(item.current_stock), minimum_stock: num(item.minimum_stock), cost_price: num(item.cost_price), outgoing_price: num(item.outgoing_price), is_active: num(item.is_active) };
}
async function getItemData(id) {
  const r = await exec("SELECT i.*, c.name AS category_name FROM items i LEFT JOIN categories c ON c.id=i.category_id WHERE i.id=? AND i.is_active=1", [Number(id)]);
  if (!r.rows.length) fail('Barang tidak ditemukan.', 404);
  return normalizeItem(r.rows[0]);
}
async function login(username, password) {
  await ensureSchema();
  const r = await exec("SELECT id,username,password_hash FROM admins WHERE username=?", [String(username || '').trim()]);
  if (!r.rows.length || !(await bcrypt.compare(String(password || ''), r.rows[0].password_hash))) fail('Username atau password salah.', 401);
  const admin = { id: num(r.rows[0].id), username: r.rows[0].username };
  localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
  localStorage.setItem(TOKEN_KEY, 'browser-session');
  return { admin, token: 'browser-session', tokenType: 'Local', expiresIn: 'local' };
}
async function logout() { clearSession(); window.dispatchEvent(new CustomEvent('exgudang:logout')); }
async function getProfile() { await ensureSchema(); requireAuth(); const r = await exec("SELECT id,username,created_at FROM admins WHERE id=?", [getAdmin().id]); if (!r.rows.length) { clearSession(); fail('Akun admin tidak ditemukan.', 401); } return ok({ ...r.rows[0] }); }
async function getDashboard() {
  await ensureSchema(); requireAuth();
  const stock = (await exec("SELECT COUNT(*) AS total_items,COALESCE(SUM(current_stock),0) AS total_stock_units,COALESCE(SUM(current_stock*cost_price),0) AS total_stock_cost_value,COALESCE(SUM(current_stock*outgoing_price),0) AS total_stock_outgoing_value,SUM(CASE WHEN current_stock<=minimum_stock THEN 1 ELSE 0 END) AS low_stock_items,SUM(CASE WHEN current_stock=0 THEN 1 ELSE 0 END) AS empty_stock_items FROM items WHERE is_active=1")).rows[0];
  const monthly = (await exec("SELECT COUNT(*) AS total_movements,COALESCE(SUM(CASE WHEN movement_type='IN' THEN quantity ELSE 0 END),0) AS total_in_quantity,COALESCE(SUM(CASE WHEN movement_type='OUT' THEN quantity ELSE 0 END),0) AS total_out_quantity,COALESCE(SUM(CASE WHEN movement_type='OUT' THEN outgoing_total ELSE 0 END),0) AS total_outgoing_value,COALESCE(SUM(CASE WHEN movement_type='OUT' THEN outgoing_total-cost_total ELSE 0 END),0) AS estimated_profit FROM stock_movements WHERE strftime('%Y-%m',occurred_at)=strftime('%Y-%m','now')")).rows[0];
  const daily = (await exec("SELECT COALESCE(SUM(CASE WHEN movement_type='IN' THEN quantity ELSE 0 END),0) AS total_in_quantity,COALESCE(SUM(CASE WHEN movement_type='OUT' THEN quantity ELSE 0 END),0) AS total_out_quantity FROM stock_movements WHERE date(occurred_at)=date('now')")).rows[0];
  const recent = await exec("SELECT sm.*,i.code AS item_code,i.name AS item_name,i.unit FROM stock_movements sm JOIN items i ON i.id=sm.item_id ORDER BY sm.occurred_at DESC,sm.id DESC LIMIT 5");
  const alerts = await exec("SELECT id,code,name,unit,current_stock,minimum_stock FROM items WHERE is_active=1 AND current_stock<=minimum_stock ORDER BY current_stock ASC,name ASC LIMIT 10");
  const numeric = (o) => Object.fromEntries(Object.entries(o).map(([k,v]) => [k,num(v)]));
  return ok({ summary: { stock:numeric(stock), monthly:numeric(monthly), daily:numeric(daily) }, recent_movements:rows(recent), stock_alerts:rows(alerts).map(normalizeItem) });
}
async function getCategories() { await ensureSchema(); requireAuth(); return ok(rows(await exec("SELECT c.*,COUNT(i.id) AS item_count FROM categories c LEFT JOIN items i ON i.category_id=c.id GROUP BY c.id ORDER BY c.name ASC"))); }
async function createCategory(data) { await ensureSchema(); requireAuth(); const name=String(data.name||'').trim(); if(!name) fail('Nama kategori wajib diisi.'); const r=await exec("INSERT INTO categories(name,description) VALUES(?,?)",[name,data.description||null]); return {success:true,message:'Kategori berhasil ditambahkan',data:{id:num(r.lastInsertRowid),name,description:data.description||null}}; }
async function updateCategory(id,data) { await ensureSchema(); requireAuth(); const old=await exec("SELECT * FROM categories WHERE id=?",[Number(id)]); if(!old.rows.length) fail('Kategori tidak ditemukan.',404); const name=data.name===undefined?old.rows[0].name:String(data.name).trim(); const description=data.description===undefined?old.rows[0].description:data.description; if(!name) fail('Nama kategori wajib diisi.'); await exec("UPDATE categories SET name=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[name,description,Number(id)]); return {success:true,message:'Kategori berhasil diperbarui',data:{...old.rows[0],name,description}}; }
async function deleteCategory(id) { await ensureSchema(); requireAuth(); const used=await exec("SELECT COUNT(*) AS total FROM items WHERE category_id=?",[Number(id)]); if(num(used.rows[0].total)) fail('Kategori tidak dapat dihapus karena masih digunakan barang.',409); const r=await exec("DELETE FROM categories WHERE id=?",[Number(id)]); if(!r.rowsAffected) fail('Kategori tidak ditemukan.',404); return {success:true,message:'Kategori berhasil dihapus'}; }
async function getItems(filters={}) { await ensureSchema(); requireAuth(); const where=['i.is_active=1']; const args=[]; if(filters.search){where.push('(i.name LIKE ? COLLATE NOCASE OR i.code LIKE ? COLLATE NOCASE)');args.push('%'+filters.search+'%','%'+filters.search+'%');} if(filters.categoryId){where.push('i.category_id=?');args.push(Number(filters.categoryId));} if(filters.stockStatus==='low') where.push('i.current_stock>0 AND i.current_stock<=i.minimum_stock'); if(filters.stockStatus==='available') where.push('i.current_stock>i.minimum_stock'); if(filters.stockStatus==='empty') where.push('i.current_stock=0'); const r=await exec('SELECT i.*,c.name AS category_name FROM items i LEFT JOIN categories c ON c.id=i.category_id WHERE '+where.join(' AND ')+' ORDER BY i.name ASC',args); return ok(rows(r).map(normalizeItem),{total:r.rows.length}); }
async function createItem(d) {
  await ensureSchema(); requireAuth();
  if(!String(d.name||'').trim()||!String(d.unit||'').trim()) fail('Nama dan satuan barang wajib diisi.');
  const initial=num(d.initial_stock), minimum=num(d.minimum_stock), cost=num(d.cost_price), outgoing=num(d.outgoing_price);
  if([initial,minimum,cost,outgoing].some(x=>x<0)) fail('Nilai barang tidak boleh negatif.');
  const tx=await db.transaction('write');
  try {
    const c=await tx.execute("SELECT COALESCE(MAX(CAST(SUBSTR(code,5) AS INTEGER)),0)+1 AS next FROM items WHERE code GLOB 'BRG-[0-9]*'");
    const code='BRG-'+String(c.rows[0].next).padStart(6,'0');
    const r=await tx.execute({sql:"INSERT INTO items(code,name,category_id,unit,initial_stock,current_stock,minimum_stock,cost_price,outgoing_price,description) VALUES(?,?,?,?,?,?,?,?,?,?)",args:[code,String(d.name).trim(),d.category_id||null,String(d.unit).trim(),initial,initial,minimum,cost,outgoing,d.description||null]});
    const id=num(r.lastInsertRowid);
    if(initial>0) await tx.execute({sql:"INSERT INTO stock_movements(item_id,movement_type,quantity,unit_cost,unit_outgoing_price,cost_total,outgoing_total,stock_before,stock_after,note) VALUES(?,'IN',?,?,?,?,?,0,?,'Stok awal barang')",args:[id,initial,cost,outgoing,initial*cost,initial*outgoing,initial]});
    await tx.commit();
    return {success:true,message:'Barang berhasil ditambahkan',data:await getItemData(id)};
  } catch(e) { await tx.rollback(); throw e; } finally { tx.close(); }
}
async function updateItem(id,d) { await ensureSchema(); requireAuth(); const current=await getItemData(id); const fields=['name','category_id','unit','minimum_stock','cost_price','outgoing_price','description']; const v=fields.map(k=>d[k]===undefined?current[k]:d[k]); const [name,categoryId,unit,min,cost,outgoing,description]=v; if(!String(name||'').trim()||!String(unit||'').trim()||[min,cost,outgoing].some(x=>num(x)<0)) fail('Data barang tidak valid.'); await exec("UPDATE items SET name=?,category_id=?,unit=?,minimum_stock=?,cost_price=?,outgoing_price=?,description=?,updated_at=datetime('now') WHERE id=? AND is_active=1",[String(name).trim(),categoryId||null,String(unit).trim(),num(min),num(cost),num(outgoing),description,Number(id)]); return {success:true,message:'Informasi barang berhasil diperbarui',data:await getItemData(id)}; }
async function deactivateItem(id) { await ensureSchema(); requireAuth(); const item=await getItemData(id); await exec("UPDATE items SET is_active=0,updated_at=datetime('now') WHERE id=?",[Number(id)]); return {success:true,message:'Barang berhasil dinonaktifkan',data:{id:item.id,code:item.code,name:item.name}}; }
async function stockTransaction(id,d,type) {
  await ensureSchema(); requireAuth(); const quantity=num(d.quantity); if(!(quantity>0)) fail('Jumlah transaksi harus lebih dari 0.');
  const tx=await db.transaction('write');
  try {
    const found=await tx.execute({sql:"SELECT * FROM items WHERE id=? AND is_active=1",args:[Number(id)]}); if(!found.rows.length) fail('Barang tidak ditemukan atau sudah dinonaktifkan.',404);
    const item={...found.rows[0]}, before=num(item.current_stock); if(type==='OUT'&&quantity>before) fail('Stok tidak mencukupi. Stok tersedia: '+before);
    const after=type==='IN'?before+quantity:before-quantity, unitCost=type==='IN'?num(d.unit_cost??item.cost_price):num(item.cost_price), unitOut=num(d.unit_outgoing_price??item.outgoing_price), occurred=d.occurred_at||new Date().toISOString();
    if(unitCost<0||unitOut<0) fail('Harga tidak boleh negatif.');
    const average=type==='IN'?(after>0?((before*num(item.cost_price))+(quantity*unitCost))/after:unitCost):num(item.cost_price);
    if(type==='IN') await tx.execute({sql:"UPDATE items SET current_stock=?,cost_price=?,outgoing_price=?,updated_at=? WHERE id=?",args:[after,average,unitOut,occurred,Number(id)]});
    else await tx.execute({sql:"UPDATE items SET current_stock=?,updated_at=? WHERE id=?",args:[after,occurred,Number(id)]});
    const ins=await tx.execute({sql:"INSERT INTO stock_movements(item_id,movement_type,quantity,unit_cost,unit_outgoing_price,cost_total,outgoing_total,stock_before,stock_after,supplier,destination,note,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",args:[Number(id),type,quantity,unitCost,unitOut,quantity*unitCost,quantity*unitOut,before,after,type==='IN'?(d.supplier||null):null,type==='OUT'?(d.destination||null):null,d.note||(type==='IN'?'Stok masuk':'Stok keluar'),occurred]});
    await tx.commit();
    return {movement_id:num(ins.lastInsertRowid),item_id:num(id),item_code:item.code,item_name:item.name,movement_type:type,quantity,stock_before:before,stock_after:after,unit_cost:unitCost,average_cost_after:average,unit_outgoing_price:unitOut,cost_total:quantity*unitCost,outgoing_total:quantity*unitOut,estimated_profit:type==='OUT'?(quantity*unitOut)-(quantity*unitCost):0,occurred_at:occurred};
  } catch(e) { await tx.rollback(); throw e; } finally { tx.close(); }
}
async function getItemMovements(id,limit=50,offset=0) { await ensureSchema(); requireAuth(); const l=Math.min(200,Math.max(1,num(limit))),o=Math.max(0,num(offset)); const r=await exec("SELECT * FROM stock_movements WHERE item_id=? ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?",[Number(id),l,o]); const c=await exec("SELECT COUNT(*) AS total FROM stock_movements WHERE item_id=?",[Number(id)]); return ok(rows(r),{total:num(c.rows[0].total),limit:l,offset:o}); }
async function getReportSummary() { await ensureSchema(); requireAuth(); const r=await exec("SELECT COUNT(*) AS total_items,COALESCE(SUM(current_stock*cost_price),0) AS total_stock_cost_value,COALESCE(SUM(current_stock*outgoing_price),0) AS total_stock_outgoing_value FROM items WHERE is_active=1"); const data={...r.rows[0]}; data.estimated_stock_margin=num(data.total_stock_outgoing_value)-num(data.total_stock_cost_value); return ok(data); }
async function getLowStockItems() { await ensureSchema(); requireAuth(); const r=await exec("SELECT * FROM items WHERE is_active=1 AND current_stock<=minimum_stock ORDER BY current_stock ASC,name ASC"); return ok(rows(r).map(normalizeItem),{total:r.rows.length}); }
async function getMovementReport(startDate,endDate) { await ensureSchema(); requireAuth(); if(startDate&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(startDate)) fail('Format startDate tidak valid.'); if(endDate&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(endDate)) fail('Format endDate tidak valid.'); if(startDate&&endDate&&startDate>endDate) fail('startDate tidak boleh melewati endDate.'); const cond=[],args=[]; if(startDate){cond.push('date(occurred_at)>=date(?)');args.push(startDate);} if(endDate){cond.push('date(occurred_at)<=date(?)');args.push(endDate);} const r=await exec("SELECT COUNT(*) AS total_movements,COALESCE(SUM(CASE WHEN movement_type='IN' THEN quantity ELSE 0 END),0) AS total_in_quantity,COALESCE(SUM(CASE WHEN movement_type='OUT' THEN quantity ELSE 0 END),0) AS total_out_quantity,COALESCE(SUM(CASE WHEN movement_type='IN' THEN cost_total ELSE 0 END),0) AS total_in_cost_value,COALESCE(SUM(CASE WHEN movement_type='OUT' THEN cost_total ELSE 0 END),0) AS total_out_cost_value,COALESCE(SUM(CASE WHEN movement_type='OUT' THEN outgoing_total ELSE 0 END),0) AS total_outgoing_value,COALESCE(SUM(CASE WHEN movement_type='OUT' THEN outgoing_total-cost_total ELSE 0 END),0) AS estimated_profit FROM stock_movements"+(cond.length?' WHERE '+cond.join(' AND '):''),args); return {success:true,period:{startDate,endDate},data:{...r.rows[0]}}; }
async function getRecentMovements(limit=20) { await ensureSchema(); requireAuth(); const l=Math.min(100,Math.max(1,num(limit))); const r=await exec("SELECT sm.*,i.code AS item_code,i.name AS item_name,i.unit FROM stock_movements sm JOIN items i ON i.id=sm.item_id ORDER BY sm.occurred_at DESC,sm.id DESC LIMIT ?",[l]); return ok(rows(r),{total:r.rows.length}); }
function guarded(fn) { return async (...args) => { try { return await fn(...args); } catch(e) { if(e.statusCode===401){clearSession();window.dispatchEvent(new CustomEvent('exgudang:unauthorized'));} throw e; } }; }

window.ExGudangAPI = {
  getToken,getAdmin,isAuthenticated,clearSession,
  login:guarded(login),logout,
  getProfile:guarded(getProfile),getDashboard:guarded(getDashboard),
  getCategories:guarded(getCategories),createCategory:guarded(createCategory),updateCategory:guarded(updateCategory),deleteCategory:guarded(deleteCategory),
  getItems:guarded(getItems),getItem:guarded(async(id)=>{await ensureSchema();requireAuth();return ok(await getItemData(id));}),
  createItem:guarded(createItem),updateItem:guarded(updateItem),deactivateItem:guarded(deactivateItem),
  stockIn:guarded(async(id,d)=>({success:true,message:'Stok masuk berhasil dicatat',data:await stockTransaction(id,d,'IN')})),
  stockOut:guarded(async(id,d)=>({success:true,message:'Stok keluar berhasil dicatat',data:await stockTransaction(id,d,'OUT')})),
  getItemMovements:guarded(getItemMovements),getReportSummary:guarded(getReportSummary),getLowStockItems:guarded(getLowStockItems),
  getMovementReport:guarded(getMovementReport),getRecentMovements:guarded(getRecentMovements)
};
