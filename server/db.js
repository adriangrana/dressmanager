import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const PUBLIC_DIR = path.join(ROOT, "public");
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(path.join(PUBLIC_DIR, "uploads"), { recursive: true });

export const db = new Database(path.join(DATA_DIR, "dressmanager.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dresses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Estándar',
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    size_label TEXT NOT NULL DEFAULT '',
    size_range TEXT NOT NULL DEFAULT '',
    purchase_cost REAL NOT NULL DEFAULT 0,
    rent_price REAL NOT NULL,
    included_hours INTEGER NOT NULL DEFAULT 2,
    extra_hour_price REAL NOT NULL DEFAULT 0,
    interior_price REAL NOT NULL DEFAULT 230,
    interior_included_minutes INTEGER NOT NULL DEFAULT 30,
    interior_extra_30m REAL NOT NULL DEFAULT 25,
    interior_maintenance REAL NOT NULL DEFAULT 15,
    exterior_price REAL NOT NULL DEFAULT 350,
    exterior_included_minutes INTEGER NOT NULL DEFAULT 120,
    exterior_extra_hour REAL NOT NULL DEFAULT 25,
    exterior_maintenance REAL NOT NULL DEFAULT 30,
    images TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    dress_id TEXT NOT NULL REFERENCES dresses(id),
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    booking_date TEXT NOT NULL,
    hours INTEGER NOT NULL,
    gross REAL NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('requested','confirmed','completed','cancelled')),
    vat REAL NOT NULL DEFAULT 0,
    helper_cost REAL NOT NULL DEFAULT 0,
    maintenance REAL NOT NULL DEFAULT 0,
    session_type TEXT NOT NULL DEFAULT 'exterior',
    studio_name TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    duration_minutes INTEGER NOT NULL DEFAULT 120,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(booking_date);
  CREATE INDEX IF NOT EXISTS bookings_dress_date_idx ON bookings(dress_id,booking_date,status);
`);

// Keep databases created by earlier versions usable after the tariff/session update.
const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};
for (const [column, definition] of Object.entries({
  category: "TEXT NOT NULL DEFAULT 'Estándar'",
  interior_price: "REAL NOT NULL DEFAULT 230", interior_included_minutes: "INTEGER NOT NULL DEFAULT 30",
  interior_extra_30m: "REAL NOT NULL DEFAULT 25", interior_maintenance: "REAL NOT NULL DEFAULT 15",
  exterior_price: "REAL NOT NULL DEFAULT 350", exterior_included_minutes: "INTEGER NOT NULL DEFAULT 120",
  exterior_extra_hour: "REAL NOT NULL DEFAULT 25", exterior_maintenance: "REAL NOT NULL DEFAULT 30",
})) ensureColumn("dresses", column, definition);
db.prepare("UPDATE dresses SET category='Premium' WHERE id='aurora-rose' AND category='Estándar'").run();
for (const [column, definition] of Object.entries({
  session_type: "TEXT NOT NULL DEFAULT 'exterior'", studio_name: "TEXT NOT NULL DEFAULT ''",
  contact_name: "TEXT NOT NULL DEFAULT ''", duration_minutes: "INTEGER NOT NULL DEFAULT 120",
})) ensureColumn("bookings", column, definition);

const defaultSettings = {
  vat_rate: 0.21,
  helper_hourly_cost: 20,
  interior_maintenance_per_session: 15,
  exterior_maintenance_per_session: 30,
};
const insertSetting = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value);

const seededDress = db.prepare("SELECT id FROM dresses WHERE id = ?").get("aurora-rose");
if (!seededDress) {
  db.prepare(`INSERT INTO dresses
    (id,name,category,color,description,size_label,size_range,purchase_cost,rent_price,included_hours,extra_hour_price,interior_price,interior_included_minutes,interior_extra_30m,interior_maintenance,exterior_price,exterior_included_minutes,exterior_extra_hour,exterior_maintenance,images,created_at)
    VALUES (@id,@name,@category,@color,@description,@size_label,@size_range,@purchase_cost,@rent_price,@included_hours,@extra_hour_price,@interior_price,@interior_included_minutes,@interior_extra_30m,@interior_maintenance,@exterior_price,@exterior_included_minutes,@exterior_extra_hour,@exterior_maintenance,@images,@created_at)`)
    .run({
      id: "aurora-rose",
      name: "Aurora Rosé",
      category: "Premium",
      color: "Rosa empolvado",
      description: "Corsé bordado con pedrería, silueta princesa y espalda ajustable.",
      size_label: "US 8 · EU 38",
      size_range: "US 6–10 · EU 36–40",
      purchase_cost: 595,
      rent_price: 350,
      included_hours: 2,
      extra_hour_price: 25,
      interior_price: 230,
      interior_included_minutes: 30,
      interior_extra_30m: 25,
      interior_maintenance: 15,
      exterior_price: 350,
      exterior_included_minutes: 120,
      exterior_extra_hour: 25,
      exterior_maintenance: 30,
      images: JSON.stringify([
        "/images/vestidos/aurora-rose/frente.png",
        "/images/vestidos/aurora-rose/espalda.png",
        "/images/vestidos/aurora-rose/bordado.png",
        "/images/vestidos/aurora-rose/detalle.png",
      ]),
      created_at: new Date().toISOString(),
    });
}

export function ensureAdmin(email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !password || String(password).length < 12) {
    throw new Error("Configura ADMIN_EMAIL y una contraseña ADMIN_PASSWORD de al menos 12 caracteres en .env.");
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) return;
  const passwordHash = bcrypt.hashSync(String(password), 12);
  db.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)")
    .run(randomUUID(), normalizedEmail, passwordHash, new Date().toISOString());
}

export function getSettings() {
  return Object.fromEntries(db.prepare("SELECT key,value FROM settings").all().map(({ key, value }) => [key, value]));
}

export function calculateRental(dress, sessionType, durationMinutes, settings = getSettings()) {
  const interior = sessionType === "interior";
  const included = Number(interior ? dress.interior_included_minutes : dress.exterior_included_minutes);
  const extraStep = interior ? 30 : 60;
  const extraPrice = Number(interior ? dress.interior_extra_30m : dress.exterior_extra_hour);
  const gross = Number(interior ? dress.interior_price : dress.exterior_price) + Math.ceil(Math.max(0, Number(durationMinutes) - included) / extraStep) * extraPrice;
  const vat = gross - gross / (1 + Number(settings.vat_rate));
  const helperCost = interior ? 0 : Number(durationMinutes) / 60 * Number(settings.helper_hourly_cost);
  const maintenance = Number(interior ? dress.interior_maintenance : dress.exterior_maintenance);
  const net = gross - vat;
  const profit = net - helperCost - maintenance;
  return { gross, vat, net, helperCost, maintenance, profit, eachShare: profit / 2 };
}

export { ROOT };
