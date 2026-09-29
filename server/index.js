import "dotenv/config";
import bcrypt from "bcryptjs";
import express from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateRental, db, ensureAdmin, getSettings, PUBLIC_DIR, ROOT } from "./db.js";

const app = express();
const port = Number(process.env.PORT || 3001);
const DRESS_CATEGORIES = ["Premium", "Estándar", "Económico", "Otra"];
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET debe tener al menos 32 caracteres. Configúralo en .env.");
}
ensureAdmin(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);

app.disable("x-powered-by");
if (isProduction) app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));
app.use(express.json({ limit: "100kb" }));

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare("SELECT data, expires_at FROM sessions WHERE sid = ?").get(sid);
      if (!row || row.expires_at <= Date.now()) {
        if (row) db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.data));
    } catch (error) { callback(error); }
  }

  set(sid, value, callback = () => {}) {
    try {
      const expiresAt = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
      db.prepare("INSERT INTO sessions(sid,data,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at")
        .run(sid, JSON.stringify(value), expiresAt);
      callback(null);
    } catch (error) { callback(error); }
  }

  destroy(sid, callback = () => {}) {
    try { db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid); callback(null); }
    catch (error) { callback(error); }
  }

  touch(sid, value, callback = () => {}) { this.set(sid, value, callback); }
}

app.use(session({
  name: "eclat.sid",
  secret: sessionSecret,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos y vuelve a probar." },
});

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
  next();
}

function publicDress(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category || "Estándar",
    color: row.color,
    description: row.description,
    sizeLabel: row.size_label,
    sizeRange: row.size_range,
    tariffs: {
      interior: { price: row.interior_price, includedMinutes: row.interior_included_minutes, extraPrice: row.interior_extra_30m, extraMinutes: 30, maintenance: row.interior_maintenance },
      exterior: { price: row.exterior_price, includedMinutes: row.exterior_included_minutes, extraPrice: row.exterior_extra_hour, extraMinutes: 60, maintenance: row.exterior_maintenance },
    },
    images: JSON.parse(row.images || "[]"),
  };
}

function adminDress(row) {
  return { ...publicDress(row), purchaseCost: row.purchase_cost, active: Boolean(row.active), createdAt: row.created_at };
}

function cleanText(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function validMoney(value, field, { allowZero = true } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < (allowZero ? 0 : 0.01) || amount > 100000) {
    throw new Error(`Revisa el importe de ${field}.`);
  }
  return Math.round(amount * 100) / 100;
}

function optionalPrice(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") return 0;
  return validMoney(value, field, { allowZero: false });
}

function hasSessionTariff(dress, type) {
  return type === "interior"
    ? Number(dress.interior_price) > 0 && Number(dress.interior_extra_30m) > 0 && Number(dress.interior_maintenance) > 0
    : Number(dress.exterior_price) > 0 && Number(dress.exterior_extra_hour) > 0 && Number(dress.exterior_maintenance) > 0;
}

function validateDate(value, allowPast = false) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) {
    throw new Error("Selecciona una fecha válida.");
  }
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (!allowPast && date < localToday) throw new Error("Elige una fecha de hoy en adelante.");
  return date;
}

function safeSlug(value) {
  return cleanText(value, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "vestido";
}

const imageExtensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      const uploadDir = path.join(PUBLIC_DIR, "uploads");
      mkdirSync(uploadDir, { recursive: true });
      callback(null, uploadDir);
    },
    filename: (req, file, callback) => callback(null, `${safeSlug(req.body?.name)}-${randomUUID()}${imageExtensions[file.mimetype] || ".img"}`),
  }),
  limits: { files: 8, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!imageExtensions[file.mimetype]) return callback(new Error("Usa imágenes JPG, PNG o WebP."));
    callback(null, true);
  },
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const email = cleanText(req.body?.email, 200).toLowerCase();
  const password = String(req.body?.password ?? "");
  const user = db.prepare("SELECT id,email,password_hash FROM users WHERE email = ?").get(email);
  const valid = user && await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Correo o contraseña incorrectos." });
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: "No se pudo iniciar sesión. Vuelve a intentarlo." });
    req.session.user = { id: user.id, email: user.email };
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: "No se pudo guardar la sesión." });
      res.json({ user: req.session.user });
    });
  });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "No hay una sesión activa." });
  res.json({ user: req.session.user });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: "No se pudo cerrar la sesión." });
    res.clearCookie("eclat.sid", { httpOnly: true, sameSite: "lax", secure: isProduction });
    res.json({ ok: true });
  });
});

app.get("/api/public/dresses", (_req, res) => {
  const rows = db.prepare("SELECT * FROM dresses WHERE active=1 AND interior_price>0 AND interior_extra_30m>0 AND interior_maintenance>0 AND exterior_price>0 AND exterior_extra_hour>0 AND exterior_maintenance>0 ORDER BY created_at DESC").all();
  res.json({ dresses: rows.map(publicDress) });
});

app.post("/api/public/requests", (req, res) => {
  try {
    const dress = db.prepare("SELECT * FROM dresses WHERE id=? AND active=1").get(cleanText(req.body?.dressId, 100));
    if (!dress) return res.status(404).json({ error: "Este vestido ya no está disponible." });
    const studioName = cleanText(req.body?.studioName, 120);
    const contactName = cleanText(req.body?.contactName, 100);
    const sessionType = cleanText(req.body?.sessionType, 20);
    const phone = cleanText(req.body?.phone, 40);
    const bookingDate = validateDate(req.body?.date);
    const durationMinutes = Number(req.body?.durationMinutes);
    if (studioName.length < 2) throw new Error("Escribe el nombre del estudio fotográfico o fotógrafo.");
    if (!['interior', 'exterior'].includes(sessionType)) throw new Error("Selecciona si la sesión será en interior o exterior.");
    if (!hasSessionTariff(dress, sessionType)) throw new Error("Este vestido aún tiene la tarifa de ese tipo de sesión pendiente de definir.");
    if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 720 || durationMinutes % 30 !== 0) throw new Error("Selecciona una duración válida en bloques de 30 minutos.");
    const occupied = db.prepare("SELECT id FROM bookings WHERE dress_id=? AND booking_date=? AND status IN ('requested','confirmed','completed')").get(dress.id, bookingDate);
    if (occupied) return res.status(409).json({ error: "Ese vestido ya tiene una sesión solicitada para ese día. Elige otra fecha." });
    const economics = calculateRental(dress, sessionType, durationMinutes);
    db.prepare(`INSERT INTO bookings(id,dress_id,customer_name,phone,booking_date,hours,gross,status,vat,helper_cost,maintenance,session_type,studio_name,contact_name,duration_minutes,created_at)
      VALUES(?,?,?,?,?,?,?,'requested',?,?,?,?,?,?,?,?)`).run(randomUUID(), dress.id, contactName || studioName, phone, bookingDate, Math.ceil(durationMinutes / 60), economics.gross, economics.vat, economics.helperCost, economics.maintenance, sessionType, studioName, contactName, durationMinutes, new Date().toISOString());
    res.status(201).json({ message: "Solicitud recibida. El atelier contactará con el estudio o fotógrafo para confirmar la disponibilidad de la sesión supervisada." });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get("/api/admin/overview", requireAdmin, (_req, res) => {
  const completed = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(vat),0) AS vat, COALESCE(SUM(helper_cost),0) AS helper, COALESCE(SUM(maintenance),0) AS maintenance FROM bookings WHERE status='completed'").get();
  const dressStats = db.prepare("SELECT COALESCE(SUM(active),0) AS count, COALESCE(SUM(purchase_cost),0) AS investment FROM dresses").get();
  const requests = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE status='requested'").get().count;
  const confirmed = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE status='confirmed'").get().count;
  const profit = completed.gross - completed.vat - completed.helper - completed.maintenance;
  res.json({
    dresses: dressStats.count,
    investment: dressStats.investment,
    completedRentals: completed.count,
    requests,
    confirmed,
    grossRevenue: completed.gross,
    vat: completed.vat,
    helperCosts: completed.helper,
    maintenance: completed.maintenance,
    distributableProfit: profit,
    eachShare: profit / 2,
    settings: getSettings(),
  });
});

app.get("/api/admin/dresses", requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM dresses ORDER BY active DESC, created_at DESC").all();
  res.json({ dresses: rows.map(adminDress) });
});

app.post("/api/admin/dresses", requireAdmin, upload.array("images", 8), (req, res) => {
  try {
    const name = cleanText(req.body.name, 100);
    const category = cleanText(req.body.category, 40);
    const color = cleanText(req.body.color, 60);
    const description = cleanText(req.body.description, 1000);
    const sizeLabel = cleanText(req.body.sizeLabel, 80);
    const sizeRange = cleanText(req.body.sizeRange, 80);
    const purchaseCost = validMoney(req.body.purchaseCost, "de compra");
    const interiorPrice = optionalPrice(req.body.interiorPrice, "de sesión interior");
    const interiorExtra = optionalPrice(req.body.interiorExtraPrice, "por cada 30 minutos adicionales");
    const interiorMaintenance = optionalPrice(req.body.interiorMaintenance, "de mantenimiento interior");
    const exteriorPrice = optionalPrice(req.body.exteriorPrice, "de sesión exterior");
    const exteriorExtra = optionalPrice(req.body.exteriorExtraPrice, "por hora adicional");
    const exteriorMaintenance = optionalPrice(req.body.exteriorMaintenance, "de mantenimiento exterior");
    if (name.length < 2 || !color) throw new Error("Añade el nombre y el color del vestido.");
    if (!DRESS_CATEGORIES.includes(category)) throw new Error("Selecciona una categoría válida.");
    const images = (req.files || []).map((file) => `/uploads/${file.filename}`);
    if (!images.length) throw new Error("Añade al menos una foto del vestido.");
    const id = `${safeSlug(name)}-${randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO dresses(id,name,category,color,description,size_label,size_range,purchase_cost,rent_price,included_hours,extra_hour_price,interior_price,interior_included_minutes,interior_extra_30m,interior_maintenance,exterior_price,exterior_included_minutes,exterior_extra_hour,exterior_maintenance,images,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, name, category, color, description, sizeLabel, sizeRange, purchaseCost, exteriorPrice, 2, exteriorExtra, interiorPrice, 30, interiorExtra, interiorMaintenance, exteriorPrice, 120, exteriorExtra, exteriorMaintenance, JSON.stringify(images), new Date().toISOString());
    res.status(201).json({ dress: adminDress(db.prepare("SELECT * FROM dresses WHERE id=?").get(id)) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.patch("/api/admin/dresses/:id", requireAdmin, upload.array("images", 8), (req, res) => {
  try {
    const existing = db.prepare("SELECT * FROM dresses WHERE id=?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "No encontramos ese vestido." });
    const name = cleanText(req.body.name ?? existing.name, 100);
    const category = cleanText(req.body.category ?? existing.category ?? "Estándar", 40);
    const color = cleanText(req.body.color ?? existing.color, 60);
    const description = cleanText(req.body.description ?? existing.description, 1000);
    const sizeLabel = cleanText(req.body.sizeLabel ?? existing.size_label, 80);
    const sizeRange = cleanText(req.body.sizeRange ?? existing.size_range, 80);
    const purchaseCost = validMoney(req.body.purchaseCost ?? existing.purchase_cost, "de compra");
    const interiorPrice = optionalPrice(req.body.interiorPrice ?? existing.interior_price, "de sesión interior");
    const interiorExtra = optionalPrice(req.body.interiorExtraPrice ?? existing.interior_extra_30m, "por cada 30 minutos adicionales");
    const interiorMaintenance = optionalPrice(req.body.interiorMaintenance ?? existing.interior_maintenance, "de mantenimiento interior");
    const exteriorPrice = optionalPrice(req.body.exteriorPrice ?? existing.exterior_price, "de sesión exterior");
    const exteriorExtra = optionalPrice(req.body.exteriorExtraPrice ?? existing.exterior_extra_hour, "por hora adicional");
    const exteriorMaintenance = optionalPrice(req.body.exteriorMaintenance ?? existing.exterior_maintenance, "de mantenimiento exterior");
    const active = req.body.active === undefined ? existing.active : (req.body.active ? 1 : 0);
    const images = [...JSON.parse(existing.images || "[]"), ...(req.files || []).map((file) => `/uploads/${file.filename}`)];
    if (!DRESS_CATEGORIES.includes(category)) throw new Error("Selecciona una categoría válida.");
    db.prepare(`UPDATE dresses SET name=?,category=?,color=?,description=?,size_label=?,size_range=?,purchase_cost=?,rent_price=?,included_hours=?,extra_hour_price=?,interior_price=?,interior_extra_30m=?,interior_maintenance=?,exterior_price=?,exterior_extra_hour=?,exterior_maintenance=?,images=?,active=? WHERE id=?`)
      .run(name, category, color, description, sizeLabel, sizeRange, purchaseCost, exteriorPrice, 2, exteriorExtra, interiorPrice, interiorExtra, interiorMaintenance, exteriorPrice, exteriorExtra, exteriorMaintenance, JSON.stringify(images), active, req.params.id);
    res.json({ dress: adminDress(db.prepare("SELECT * FROM dresses WHERE id=?").get(req.params.id)) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get("/api/admin/bookings", requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT b.*, d.name AS dress_name, d.color AS dress_color
    FROM bookings b JOIN dresses d ON d.id=b.dress_id
    ORDER BY CASE b.status WHEN 'requested' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END, b.booking_date ASC`).all();
  res.json({ bookings: rows.map((row) => ({
    id: row.id,
    dressId: row.dress_id,
    dressName: row.dress_name,
    dressColor: row.dress_color,
    name: row.customer_name,
    studioName: row.studio_name || row.customer_name,
    contactName: row.contact_name,
    phone: row.phone,
    date: row.booking_date,
    hours: row.hours,
    durationMinutes: row.duration_minutes || row.hours * 60,
    sessionType: row.session_type || "exterior",
    gross: row.gross,
    status: row.status,
    vat: row.vat,
    helperCost: row.helper_cost,
    maintenance: row.maintenance,
    createdAt: row.created_at,
  })) });
});

app.post("/api/admin/bookings", requireAdmin, (req, res) => {
  try {
    const dress = db.prepare("SELECT * FROM dresses WHERE id=? AND active=1").get(cleanText(req.body?.dressId, 100));
    if (!dress) return res.status(404).json({ error: "Selecciona un vestido disponible." });
    const studioName = cleanText(req.body?.studioName, 120);
    const contactName = cleanText(req.body?.contactName, 100);
    const phone = cleanText(req.body?.phone, 40);
    const date = validateDate(req.body?.date, true);
    const sessionType = cleanText(req.body?.sessionType, 20);
    const durationMinutes = Number(req.body?.durationMinutes);
    if (studioName.length < 2) throw new Error("Añade el estudio fotográfico o fotógrafo.");
    if (!['interior', 'exterior'].includes(sessionType)) throw new Error("Selecciona el tipo de sesión.");
    if (!hasSessionTariff(dress, sessionType)) throw new Error("Define primero toda la tarifa de esta sesión para el vestido.");
    if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 720 || durationMinutes % 30 !== 0) throw new Error("Selecciona una duración válida en bloques de 30 minutos.");
    const occupied = db.prepare("SELECT id FROM bookings WHERE dress_id=? AND booking_date=? AND status IN ('requested','confirmed','completed')").get(dress.id, date);
    if (occupied) return res.status(409).json({ error: "Ya hay una sesión registrada para ese vestido y fecha." });
    const economics = calculateRental(dress, sessionType, durationMinutes);
    const id = randomUUID();
    db.prepare(`INSERT INTO bookings(id,dress_id,customer_name,phone,booking_date,hours,gross,status,vat,helper_cost,maintenance,session_type,studio_name,contact_name,duration_minutes,created_at)
      VALUES(?,?,?,?,?,?,?,'completed',?,?,?,?,?,?,?,?)`).run(id, dress.id, contactName || studioName, phone, date, Math.ceil(durationMinutes / 60), economics.gross, economics.vat, economics.helperCost, economics.maintenance, sessionType, studioName, contactName, durationMinutes, new Date().toISOString());
    res.status(201).json({ id });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.patch("/api/admin/bookings/:id/status", requireAdmin, (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id=?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "No encontramos esa solicitud." });
  const nextStatus = cleanText(req.body?.status, 20);
  const transitions = { requested: ["confirmed", "cancelled"], confirmed: ["completed", "cancelled"] };
  if (!transitions[booking.status]?.includes(nextStatus)) return res.status(400).json({ error: "Ese cambio de estado no está permitido." });
  let result;
  if (nextStatus === "completed" && booking.vat === 0 && booking.helper_cost === 0 && booking.maintenance === 0) {
    const dress = db.prepare("SELECT * FROM dresses WHERE id=?").get(booking.dress_id);
    if (!dress) return res.status(404).json({ error: "No encontramos el vestido de esta sesión." });
    const economics = calculateRental(dress, booking.session_type || "exterior", booking.duration_minutes || booking.hours * 60);
    result = db.prepare("UPDATE bookings SET status=?,vat=?,helper_cost=?,maintenance=? WHERE id=? AND status=?")
      .run(nextStatus, economics.vat, economics.helperCost, economics.maintenance, booking.id, booking.status);
  } else {
    result = db.prepare("UPDATE bookings SET status=? WHERE id=? AND status=?").run(nextStatus, booking.id, booking.status);
  }
  if (result.changes !== 1) return res.status(409).json({ error: "La solicitud cambió. Actualiza la agenda e inténtalo de nuevo." });
  res.json({ ok: true });
});

app.use(express.static(PUBLIC_DIR, { maxAge: isProduction ? "1d" : 0 }));
const distDir = path.join(ROOT, "dist");
if (isProduction && existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) return res.sendFile(path.join(distDir, "index.html"));
    next();
  });
}

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Cada foto debe pesar menos de 8 MB." : "No se pudo procesar la carga de imágenes." });
  if (error.message === "Usa imágenes JPG, PNG o WebP.") return res.status(400).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: "Se produjo un error en el servidor." });
});

const cleanupSessions = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");
const sessionCleanup = setInterval(() => cleanupSessions.run(Date.now()), 60 * 60 * 1000);
sessionCleanup.unref();

app.listen(port, isProduction ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Tul en Foco API disponible en http://127.0.0.1:${port}`);
});
