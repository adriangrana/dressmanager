import "dotenv/config";
import bcrypt from "bcryptjs";
import express from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import Tesseract from "tesseract.js";
import yazl from "yazl";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateRental, db, ensureAdmin, getSettings, DATA_DIR, PUBLIC_DIR, ROOT } from "./db.js";

const app = express();
const port = Number(process.env.PORT || 3001);
const DRESS_CATEGORIES = ["Premium", "Estándar", "Económico", "Otra"];
const isProduction = process.env.NODE_ENV === "production";
const sessionCookieName = isProduction ? "tul.prod.sid" : "tul.dev.sid";
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
  name: sessionCookieName,
  secret: sessionSecret,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction ? "auto" : false,
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
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes desde esta conexión. Prueba de nuevo más tarde." },
});
const visionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas lecturas automáticas de tablas. Espera un poco y vuelve a probar." },
});

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
  next();
}

function parseSizeGuide(row) {
  let data = { rows: [], note: "" };
  try {
    const parsed = JSON.parse(row?.size_guide_json || "{}");
    if (parsed && typeof parsed === "object") data = { rows: Array.isArray(parsed.rows) ? parsed.rows : [], note: cleanText(parsed.note, 1000) };
  } catch {}
  return { ...data, image: row?.size_guide_image || "" };
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
    sizeGuide: parseSizeGuide(row),
    tariffs: {
      interior: { price: row.interior_price, includedMinutes: row.interior_included_minutes, extraPrice: row.interior_extra_30m, extraMinutes: 30 },
      exterior: { price: row.exterior_price, includedMinutes: row.exterior_included_minutes, extraPrice: row.exterior_extra_hour, extraMinutes: 60 },
    },
    images: JSON.parse(row.images || "[]"),
  };
}

function adminDress(row) {
  const dress = publicDress(row);
  return {
    ...dress,
    tariffs: {
      interior: { ...dress.tariffs.interior, maintenance: row.interior_maintenance },
      exterior: { ...dress.tariffs.exterior, maintenance: row.exterior_maintenance },
    },
    purchaseCost: row.purchase_cost,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
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

function validateTime(value) {
  const time = cleanText(value, 5);
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error("Selecciona una hora válida.");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59 || minutes % 30 !== 0) throw new Error("La hora debe estar en bloques de 30 minutos.");
  return time;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const safe = Math.max(0, Math.min(24 * 60, Number(value) || 0));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function bookingEndTime(startTime, durationMinutes) {
  return minutesToTime(timeToMinutes(startTime) + Number(durationMinutes));
}

function hasBookingConflict(dressId, date, startTime, durationMinutes, excludeId = "") {
  const start = timeToMinutes(startTime);
  const end = start + Number(durationMinutes);
  if (end > 24 * 60) throw new Error("La sesión no puede terminar después de medianoche.");
  const rows = db.prepare("SELECT id,start_time,duration_minutes FROM bookings WHERE dress_id=? AND booking_date=? AND status IN ('requested','confirmed','completed') AND id<>?").all(dressId, date, excludeId);
  return rows.some((row) => {
    const currentStart = timeToMinutes(row.start_time || "10:00");
    const currentEnd = currentStart + Number(row.duration_minutes || 120);
    return start < currentEnd && end > currentStart;
  });
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
  limits: { files: 9, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!imageExtensions[file.mimetype]) return callback(new Error("Usa imágenes JPG, PNG o WebP."));
    callback(null, true);
  },
});

const visionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!imageExtensions[file.mimetype]) return callback(new Error("Usa una imagen JPG, PNG o WebP."));
    callback(null, true);
  },
});

function mimeFromImagePath(imagePath) {
  const ext = path.extname(imagePath || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function storedGuideImageData(imagePath) {
  const publicPath = cleanText(imagePath, 500);
  if (!publicPath.startsWith("/uploads/") && !publicPath.startsWith("/images/")) {
    throw new Error("La imagen de la guía no es válida.");
  }
  const normalized = publicPath.replace(/^\/+/, "");
  const absolute = path.resolve(PUBLIC_DIR, normalized);
  const publicRoot = path.resolve(PUBLIC_DIR) + path.sep;
  if (!absolute.startsWith(publicRoot) || !existsSync(absolute)) throw new Error("No encontramos la imagen de la guía.");
  return { buffer: readFileSync(absolute), mime: mimeFromImagePath(absolute) };
}

const { createWorker, OEM, PSM } = Tesseract;
let sizeGuideWorkerPromise = null;

function normalizeOcrText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|]/g, "I")
    .replace(/\s+/g, " ")
    .trim();
}

function ocrNumber(value) {
  const match = String(value || "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

function numericValues(words) {
  return words.map((word) => ocrNumber(word.text)).filter(Boolean);
}

const measurementAliases = {
  bust: /\b(BUST|CHEST|PECHO)\b/i,
  waist: /\b(WAIST|CINTURA)\b/i,
  hip: /\b(HIP|HIPS|CADERA|CADERAS)\b/i,
  length: /\b(LENGTH|LONGITUD|LARGO|HOLLOW|FLOOR)\b/i,
};

function measurementKey(text) {
  const normalized = normalizeOcrText(text);
  return Object.entries(measurementAliases).find(([, pattern]) => pattern.test(normalized))?.[0] || "";
}

function visualRowsFromBlocks(blocks) {
  const words = (blocks || [])
    .flatMap((block) => block.paragraphs || [])
    .flatMap((paragraph) => paragraph.lines || [])
    .flatMap((line) => line.words || [])
    .filter((word) => normalizeOcrText(word.text) && Number(word.confidence || 0) >= 18)
    .map((word) => ({
      text: normalizeOcrText(word.text),
      confidence: Number(word.confidence || 0),
      x0: Number(word.bbox?.x0 || 0),
      x1: Number(word.bbox?.x1 || 0),
      y0: Number(word.bbox?.y0 || 0),
      y1: Number(word.bbox?.y1 || 0),
      cx: (Number(word.bbox?.x0 || 0) + Number(word.bbox?.x1 || 0)) / 2,
      cy: (Number(word.bbox?.y0 || 0) + Number(word.bbox?.y1 || 0)) / 2,
    }))
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx);

  if (!words.length) return [];
  const heights = words.map((word) => Math.max(1, word.y1 - word.y0)).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 14;
  const threshold = Math.max(8, medianHeight * 0.7);
  const rows = [];

  for (const word of words) {
    let row = rows.find((candidate) => Math.abs(candidate.cy - word.cy) <= threshold);
    if (!row) {
      row = { cy: word.cy, words: [] };
      rows.push(row);
    }
    row.words.push(word);
    row.cy = row.words.reduce((sum, item) => sum + item.cy, 0) / row.words.length;
  }

  return rows
    .sort((a, b) => a.cy - b.cy)
    .map((row) => {
      row.words.sort((a, b) => a.cx - b.cx);
      return {
        ...row,
        text: row.words.map((word) => word.text).join(" "),
        confidence: row.words.reduce((sum, word) => sum + word.confidence, 0) / row.words.length,
      };
    });
}

function bestMeasurementRows(rows) {
  const found = {};
  for (const row of rows) {
    const key = measurementKey(row.text);
    if (!key) continue;
    const values = numericValues(row.words);
    if (values.length < 2) continue;
    const cmBonus = /\bCM\b|CENTIMET/i.test(row.text) ? 100 : 0;
    const median = values.map(Number).sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;
    const likelyCmBonus = median >= 60 ? 30 : 0;
    const score = cmBonus + likelyCmBonus + values.length + row.confidence / 100;
    if (!found[key] || score > found[key].score) found[key] = { row, values, score };
  }
  return found;
}

function parseHorizontalSizeTable(rows, fullText) {
  const measurementRows = bestMeasurementRows(rows);
  const keys = Object.keys(measurementRows);
  if (keys.length < 2) return null;

  const valueCounts = keys.map((key) => measurementRows[key].values.length);
  const targetCount = Math.min(...valueCounts);
  if (targetCount < 2) return null;
  const firstMeasureY = Math.min(...keys.map((key) => measurementRows[key].row.cy));

  const headerCandidates = rows
    .filter((row) => row.cy < firstMeasureY && firstMeasureY - row.cy < 350)
    .map((row) => ({ row, values: numericValues(row.words) }))
    .filter((item) => item.values.length >= targetCount);

  const usCandidate = headerCandidates
    .filter(({ row }) => /\b(US|USA|SIZE|TALLA)\b/i.test(row.text) && !/\b(EU|EUR|EURO)\b/i.test(row.text))
    .sort((a, b) => Math.abs(a.values.length - targetCount) - Math.abs(b.values.length - targetCount))[0]
    || headerCandidates
      .filter(({ values }) => values.slice(0, targetCount).every((value) => Number(value) <= 32))
      .sort((a, b) => b.row.cy - a.row.cy)[0];

  if (!usCandidate) return null;
  const usValues = usCandidate.values.slice(-targetCount);

  const euCandidate = headerCandidates
    .filter(({ row }) => /\b(EU|EUR|EURO)\b/i.test(row.text))
    .sort((a, b) => Math.abs(a.values.length - targetCount) - Math.abs(b.values.length - targetCount))[0];
  const euValues = euCandidate?.values?.slice(-targetCount) || [];

  const resultRows = Array.from({ length: targetCount }, (_, index) => {
    const us = usValues[index] || "";
    const eu = euValues[index] || "";
    const label = eu ? `US ${us} · EU ${eu}` : `US ${us}`;
    return {
      size: label,
      bust: measurementRows.bust?.values?.slice(-targetCount)?.[index] || "",
      waist: measurementRows.waist?.values?.slice(-targetCount)?.[index] || "",
      hip: measurementRows.hip?.values?.slice(-targetCount)?.[index] || "",
      length: measurementRows.length?.values?.slice(-targetCount)?.[index] || "",
    };
  }).filter((row) => row.size && [row.bust, row.waist, row.hip, row.length].some(Boolean));

  if (resultRows.length < 2) return null;
  const warnings = [];
  if (/\bINCH|INCHES\b/i.test(fullText) && /\bCM\b/i.test(fullText)) warnings.push("La imagen contiene centímetros y pulgadas; revisa que la fila extraída sea la de centímetros.");
  if (keys.length < 4) warnings.push("No se reconocieron todas las medidas; completa manualmente las columnas vacías.");
  return { rows: resultRows, warnings };
}

function exactHeaderWord(words, pattern) {
  return words.find((word) => pattern.test(normalizeOcrText(word.text)));
}

function nearestNumericWord(words, targetX, maxDistance = Infinity) {
  const candidates = words
    .map((word) => ({ word, value: ocrNumber(word.text), distance: Math.abs(word.cx - targetX) }))
    .filter((item) => item.value && item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || b.word.confidence - a.word.confidence);
  return candidates[0] || null;
}

function ocrSizeValue(value) {
  const normalized = normalizeOcrText(value).toUpperCase();
  const match = normalized.match(/\b(\d{1,2})(W)?\b/);
  return match ? `${match[1]}${match[2] || ""}` : "";
}

function sizeGuideHeader(rows) {
  let best = null;

  for (let index = 0; index < rows.length; index += 1) {
    const titleRow = rows[index];
    const titleWords = titleRow.words;
    const parents = {
      bust: exactHeaderWord(titleWords, /^(BUST|CHEST|PECHO)$/i),
      waist: exactHeaderWord(titleWords, /^(WAIST|CINTURA)$/i),
      hip: exactHeaderWord(titleWords, /^(HIP|HIPS|CADERA|CADERAS)$/i),
      length: exactHeaderWord(titleWords, /^(HOLLOW|LENGTH|LONGITUD|LARGO|FLOOR)$/i),
    };
    const parentEntries = Object.entries(parents).filter(([, word]) => word);
    if (parentEntries.length < 3) continue;

    const nextRows = rows.slice(index + 1, Math.min(rows.length, index + 4));
    const subWords = nextRows.flatMap((row) => row.words);
    const cmWords = subWords.filter((word) => /^CM$/i.test(normalizeOcrText(word.text))).sort((a, b) => a.cx - b.cx);

    const columns = {};
    for (const [key, parent] of parentEntries) {
      const candidates = cmWords
        .filter((word) => word.cx >= parent.cx - 8)
        .map((word) => ({ word, distance: Math.abs(word.cx - parent.cx) }))
        .sort((a, b) => a.distance - b.distance);
      columns[key] = candidates[0]?.word?.cx ?? parent.cx;
    }

    const usWord = exactHeaderWord(titleWords, /^(US|USA)$/i)
      || exactHeaderWord(subWords, /^(US|USA)$/i);
    const euWord = exactHeaderWord(titleWords, /^(EU|EUR|EUROPE|EURO)$/i)
      || exactHeaderWord(subWords, /^(EU|EUR|EUROPE|EURO)$/i);

    if (usWord) columns.size = usWord.cx;
    if (euWord) columns.eu = euWord.cx;

    const score = parentEntries.length * 3 + (columns.size !== undefined ? 2 : 0) + (columns.eu !== undefined ? 1 : 0) + cmWords.length;
    if (!best || score > best.score) {
      best = {
        columns,
        score,
        startIndex: index,
        endIndex: Math.min(rows.length - 1, index + Math.max(1, nextRows.findIndex((row) => /\bCM\b/i.test(row.text)) + 1)),
        usedCmSubcolumns: cmWords.length >= parentEntries.length,
      };
    }
  }

  return best;
}

function parseVerticalSizeTable(rows, fullText) {
  const header = sizeGuideHeader(rows);
  if (!header || header.columns.size === undefined) return null;

  const columns = header.columns;
  const xPositions = Object.values(columns).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = xPositions.slice(1).map((value, index) => value - xPositions[index]).filter((gap) => gap > 8);
  const medianGap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 70;
  const maxDistance = Math.max(24, medianGap * 0.48);
  const result = [];

  for (const row of rows.slice(header.endIndex + 1, header.endIndex + 36)) {
    if (/PLUS\s*SIZE|CUSTOMIZED|CUSTOMI[ZS]ED/i.test(row.text)) continue;

    const sizeWord = row.words
      .map((word) => ({ word, value: ocrSizeValue(word.text), distance: Math.abs(word.cx - columns.size) }))
      .filter((item) => item.value && item.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance || b.word.confidence - a.word.confidence)[0];

    if (!sizeWord) continue;
    const us = sizeWord.value;
    const usNumber = Number(us.replace(/W$/i, ""));
    if (!Number.isFinite(usNumber) || usNumber > 40) continue;

    const euMatch = columns.eu !== undefined ? nearestNumericWord(row.words, columns.eu, maxDistance) : null;
    const eu = euMatch?.value || "";

    const bust = columns.bust !== undefined ? nearestNumericWord(row.words, columns.bust, maxDistance)?.value || "" : "";
    const waist = columns.waist !== undefined ? nearestNumericWord(row.words, columns.waist, maxDistance)?.value || "" : "";
    const hip = columns.hip !== undefined ? nearestNumericWord(row.words, columns.hip, maxDistance)?.value || "" : "";
    const length = columns.length !== undefined ? nearestNumericWord(row.words, columns.length, maxDistance)?.value || "" : "";

    const measurements = [bust, waist, hip, length].filter(Boolean);
    if (measurements.length < 2) continue;

    result.push({
      size: eu ? `US ${us} · EU ${eu}` : `US ${us}`,
      bust,
      waist,
      hip,
      length,
    });
  }

  if (result.length < 2) return null;
  const warnings = [];
  if (!header.usedCmSubcolumns && /\bINCH|INCHES\b/i.test(fullText) && /\bCM\b/i.test(fullText)) {
    warnings.push("No pude aislar con total seguridad las subcolumnas en centímetros; revisa los valores.");
  }
  if (!columns.eu) warnings.push("No se reconoció la columna europea; las tallas se muestran como US.");
  if (!columns.length) warnings.push("No se reconoció la medida Hollow/Largo; completa esa columna manualmente.");
  return { rows: result.slice(0, 20), warnings };
}

function parseSizeGuideOcr(blocks, rawText) {
  const rows = visualRowsFromBlocks(blocks);
  // Las tablas normales de fabricante tienen las tallas en filas y las medidas en columnas.
  // Se intenta ese formato primero para no confundir columnas en pulgadas con las columnas en cm.
  const parsed = parseVerticalSizeTable(rows, rawText) || parseHorizontalSizeTable(rows, rawText);
  if (!parsed?.rows?.length) {
    throw new Error("He podido leer texto, pero no reconstruir la tabla con seguridad. Puedes introducir las medidas manualmente.");
  }

  const deduped = [];
  const seen = new Set();
  let discardedValues = 0;
  const plausibleMeasurement = (field, value) => {
    if (!value) return "";
    const number = Number(value);
    const [min, max] = field === "length" ? [80, 220] : [40, 200];
    if (!Number.isFinite(number) || number < min || number > max) {
      discardedValues += 1;
      return "";
    }
    return String(value);
  };
  for (const row of parsed.rows) {
    const key = row.size.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...row,
      bust: plausibleMeasurement("bust", row.bust),
      waist: plausibleMeasurement("waist", row.waist),
      hip: plausibleMeasurement("hip", row.hip),
      length: plausibleMeasurement("length", row.length),
    });
  }
  const warnings = [...(parsed.warnings || [])];
  if (discardedValues) warnings.push(`Se descartaron ${discardedValues} valores imposibles para centímetros; revisa las celdas vacías.`);
  return {
    rows: deduped,
    note: "Medidas extraídas localmente de la imagen del fabricante. Revísalas antes de guardar.",
    warnings,
  };
}

async function getSizeGuideWorker() {
  if (!sizeGuideWorkerPromise) {
    const langPath = path.join(ROOT, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
    const modelPath = path.join(langPath, "eng.traineddata.gz");
    if (!existsSync(modelPath)) throw new Error("Falta el modelo OCR local. Ejecuta npm install y vuelve a desplegar la aplicación.");
    sizeGuideWorkerPromise = createWorker("eng", OEM.LSTM_ONLY, {
      langPath,
      gzip: true,
      cacheMethod: "none",
      logger: () => {},
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return worker;
    }).catch((error) => {
      sizeGuideWorkerPromise = null;
      throw error;
    });
  }
  return sizeGuideWorkerPromise;
}

async function extractSizeGuideFromImage(buffer) {
  const worker = await getSizeGuideWorker();
  const result = await worker.recognize(buffer, {}, { text: true, blocks: true });
  const rawText = normalizeOcrText(result.data?.text || "");
  if (!rawText) throw new Error("El OCR local no detectó texto legible en la imagen.");
  const parsed = parseSizeGuideOcr(result.data?.blocks || [], rawText);
  return {
    ...parsed,
    engine: "Tesseract.js 7 · local",
    rawText: rawText.slice(0, 4000),
  };
}

function csvCell(value) {
  const textValue = String(value ?? "");
  const trimmed = textValue.trim();
  const numeric = /^-?\d+(?:\.\d+)?$/.test(trimmed);
  const safeValue = /^[\s\uFEFF]*[=+\-@]/.test(textValue) && !numeric ? `'${textValue}` : textValue;
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replace(/"/g, '""')}"` : safeValue;
}

function collectUploadEntries(root, prefix = "public/uploads") {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const fullPath = path.join(root, name);
    const zipName = `${prefix}/${name}`;
    return statSync(fullPath).isDirectory() ? collectUploadEntries(fullPath, zipName) : [{ name: zipName, path: fullPath }];
  });
}

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
    res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: "lax", secure: isProduction && req.secure });
    res.json({ ok: true });
  });
});

app.get("/api/public/dresses", (_req, res) => {
  const rows = db.prepare("SELECT * FROM dresses WHERE active=1 AND interior_price>0 AND interior_extra_30m>0 AND interior_maintenance>0 AND exterior_price>0 AND exterior_extra_hour>0 AND exterior_maintenance>0 ORDER BY created_at DESC").all();
  res.json({ dresses: rows.map(publicDress) });
});

app.post("/api/public/requests", requestLimiter, (req, res) => {
  try {
    const dress = db.prepare("SELECT * FROM dresses WHERE id=? AND active=1").get(cleanText(req.body?.dressId, 100));
    if (!dress) return res.status(404).json({ error: "Este vestido ya no está disponible." });
    const studioName = cleanText(req.body?.studioName, 120);
    const contactName = cleanText(req.body?.contactName, 100);
    const sessionType = cleanText(req.body?.sessionType, 20);
    const phone = cleanText(req.body?.phone, 40);
    const bookingDate = validateDate(req.body?.date);
    const startTime = validateTime(req.body?.startTime);
    const durationMinutes = Number(req.body?.durationMinutes);
    if (studioName.length < 2) throw new Error("Escribe el nombre del estudio fotográfico o fotógrafo.");
    if (!["interior", "exterior"].includes(sessionType)) throw new Error("Selecciona si la sesión será en interior o exterior.");
    if (!hasSessionTariff(dress, sessionType)) throw new Error("Este vestido aún tiene la tarifa de ese tipo de sesión pendiente de definir.");
    if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 720 || durationMinutes % 30 !== 0) throw new Error("Selecciona una duración válida en bloques de 30 minutos.");
    if (hasBookingConflict(dress.id, bookingDate, startTime, durationMinutes)) return res.status(409).json({ error: "Ese vestido ya está ocupado en ese horario. Elige otra hora o fecha." });
    const economics = calculateRental(dress, sessionType, durationMinutes);
    db.prepare(`INSERT INTO bookings
      (id,dress_id,customer_name,phone,booking_date,hours,gross,status,vat,helper_cost,maintenance,session_type,studio_name,contact_name,duration_minutes,start_time,payment_status,paid_at,notes,created_at)
      VALUES (@id,@dressId,@customerName,@phone,@date,@hours,@gross,'requested',@vat,@helper,@maintenance,@sessionType,@studioName,@contactName,@durationMinutes,@startTime,'pending',NULL,'',@createdAt)`)
      .run({
        id: randomUUID(), dressId: dress.id, customerName: contactName || studioName, phone, date: bookingDate,
        hours: Math.ceil(durationMinutes / 60), gross: economics.gross, vat: economics.vat, helper: economics.helperCost,
        maintenance: economics.maintenance, sessionType, studioName, contactName, durationMinutes, startTime, createdAt: new Date().toISOString(),
      });
    res.status(201).json({ message: "Solicitud recibida. El atelier contactará con el estudio o fotógrafo para confirmar la disponibilidad de la sesión supervisada." });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get("/api/admin/overview", requireAdmin, (_req, res) => {
  const completed = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(gross),0) AS gross FROM bookings WHERE status='completed'").get();
  const paid = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(vat),0) AS vat, COALESCE(SUM(helper_cost),0) AS helper, COALESCE(SUM(maintenance),0) AS maintenance FROM bookings WHERE status='completed' AND payment_status='paid'").get();
  const expenses = db.prepare("SELECT COALESCE(SUM(maintenance_expense),0) AS maintenanceExpense FROM bookings WHERE status='completed'").get();
  const outstanding = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(gross),0) AS gross FROM bookings WHERE status='completed' AND payment_status<>'paid'").get();
  const unverified = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(gross),0) AS gross FROM bookings WHERE status='completed' AND payment_status='unverified'").get();
  const dressStats = db.prepare("SELECT COALESCE(SUM(active),0) AS count, COALESCE(SUM(purchase_cost),0) AS investment FROM dresses").get();
  const requests = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE status='requested'").get().count;
  const confirmed = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE status='confirmed'").get().count;
  const profit = paid.gross - paid.vat - paid.helper - paid.maintenance;
  res.json({
    dresses: dressStats.count,
    investment: dressStats.investment,
    completedRentals: completed.count,
    paidRentals: paid.count,
    requests,
    confirmed,
    grossRevenue: paid.gross,
    accruedRevenue: completed.gross,
    outstandingRevenue: outstanding.gross,
    outstandingCount: outstanding.count,
    unverifiedRevenue: unverified.gross,
    unverifiedCount: unverified.count,
    vat: paid.vat,
    helperCosts: paid.helper,
    maintenance: paid.maintenance,
    maintenanceExpenses: expenses.maintenanceExpense,
    maintenanceBalance: paid.maintenance - expenses.maintenanceExpense,
    distributableProfit: profit,
    eachShare: profit / 2,
    settings: getSettings(),
  });
});

app.post("/api/admin/size-guide/read", requireAdmin, visionLimiter, visionUpload.single("image"), async (req, res) => {
  try {
    let image;
    if (req.file?.buffer) image = { buffer: req.file.buffer, mime: req.file.mimetype };
    else if (req.body?.imagePath) image = storedGuideImageData(req.body.imagePath);
    else throw new Error("Selecciona o guarda primero una imagen de la guía de tallas.");

    const extracted = await extractSizeGuideFromImage(image.buffer);
    res.json(extracted);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/dresses", requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM dresses ORDER BY active DESC, created_at DESC").all();
  res.json({ dresses: rows.map(adminDress) });
});

app.post("/api/admin/dresses", requireAdmin, upload.fields([{ name: "images", maxCount: 8 }, { name: "sizeGuideImage", maxCount: 1 }]), (req, res) => {
  try {
    const name = cleanText(req.body.name, 100);
    const category = cleanText(req.body.category, 40);
    const color = cleanText(req.body.color, 60);
    const description = cleanText(req.body.description, 1000);
    const sizeLabel = cleanText(req.body.sizeLabel, 80);
    const sizeRange = cleanText(req.body.sizeRange, 80);
    const sizeGuideData = cleanText(req.body.sizeGuideData, 12000);
    let sizeGuideJson = "";
    if (sizeGuideData) {
      let parsed;
      try { parsed = JSON.parse(sizeGuideData); } catch { throw new Error("No se pudo interpretar la guía de tallas."); }
      const rows = Array.isArray(parsed?.rows) ? parsed.rows.slice(0, 20).map((row) => ({
        size: cleanText(row?.size, 60), bust: cleanText(row?.bust, 20), waist: cleanText(row?.waist, 20),
        hip: cleanText(row?.hip, 20), length: cleanText(row?.length, 20),
      })).filter((row) => row.size) : [];
      sizeGuideJson = JSON.stringify({ rows, note: cleanText(parsed?.note, 1000) });
    }
    const purchaseCost = validMoney(req.body.purchaseCost, "de compra");
    const interiorPrice = optionalPrice(req.body.interiorPrice, "de sesión interior");
    const interiorExtra = optionalPrice(req.body.interiorExtraPrice, "por cada 30 minutos adicionales");
    const interiorMaintenance = optionalPrice(req.body.interiorMaintenance, "de mantenimiento interior");
    const exteriorPrice = optionalPrice(req.body.exteriorPrice, "de sesión exterior");
    const exteriorExtra = optionalPrice(req.body.exteriorExtraPrice, "por hora adicional");
    const exteriorMaintenance = optionalPrice(req.body.exteriorMaintenance, "de mantenimiento exterior");
    if (name.length < 2 || !color) throw new Error("Añade el nombre y el color del vestido.");
    if (!DRESS_CATEGORIES.includes(category)) throw new Error("Selecciona una categoría válida.");
    const images = (req.files?.images || []).map((file) => `/uploads/${file.filename}`);
    const sizeGuideImage = req.files?.sizeGuideImage?.[0] ? `/uploads/${req.files.sizeGuideImage[0].filename}` : "";
    if (!images.length) throw new Error("Añade al menos una foto del vestido.");
    const id = `${safeSlug(name)}-${randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO dresses(id,name,category,color,description,size_label,size_range,size_guide_json,size_guide_image,purchase_cost,rent_price,included_hours,extra_hour_price,interior_price,interior_included_minutes,interior_extra_30m,interior_maintenance,exterior_price,exterior_included_minutes,exterior_extra_hour,exterior_maintenance,images,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, name, category, color, description, sizeLabel, sizeRange, sizeGuideJson, sizeGuideImage, purchaseCost, exteriorPrice, 2, exteriorExtra, interiorPrice, 30, interiorExtra, interiorMaintenance, exteriorPrice, 120, exteriorExtra, exteriorMaintenance, JSON.stringify(images), new Date().toISOString());
    res.status(201).json({ dress: adminDress(db.prepare("SELECT * FROM dresses WHERE id=?").get(id)) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.patch("/api/admin/dresses/:id", requireAdmin, upload.fields([{ name: "images", maxCount: 8 }, { name: "sizeGuideImage", maxCount: 1 }]), (req, res) => {
  try {
    const existing = db.prepare("SELECT * FROM dresses WHERE id=?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "No encontramos ese vestido." });
    const name = cleanText(req.body.name ?? existing.name, 100);
    const category = cleanText(req.body.category ?? existing.category ?? "Estándar", 40);
    const color = cleanText(req.body.color ?? existing.color, 60);
    const description = cleanText(req.body.description ?? existing.description, 1000);
    const sizeLabel = cleanText(req.body.sizeLabel ?? existing.size_label, 80);
    const sizeRange = cleanText(req.body.sizeRange ?? existing.size_range, 80);
    let sizeGuideJson = existing.size_guide_json || "";
    if (req.body.sizeGuideData !== undefined) {
      const raw = cleanText(req.body.sizeGuideData, 12000);
      if (!raw) sizeGuideJson = "";
      else {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { throw new Error("No se pudo interpretar la guía de tallas."); }
        const rows = Array.isArray(parsed?.rows) ? parsed.rows.slice(0, 20).map((row) => ({
          size: cleanText(row?.size, 60), bust: cleanText(row?.bust, 20), waist: cleanText(row?.waist, 20),
          hip: cleanText(row?.hip, 20), length: cleanText(row?.length, 20),
        })).filter((row) => row.size) : [];
        sizeGuideJson = JSON.stringify({ rows, note: cleanText(parsed?.note, 1000) });
      }
    }
    const purchaseCost = validMoney(req.body.purchaseCost ?? existing.purchase_cost, "de compra");
    const interiorPrice = optionalPrice(req.body.interiorPrice ?? existing.interior_price, "de sesión interior");
    const interiorExtra = optionalPrice(req.body.interiorExtraPrice ?? existing.interior_extra_30m, "por cada 30 minutos adicionales");
    const interiorMaintenance = optionalPrice(req.body.interiorMaintenance ?? existing.interior_maintenance, "de mantenimiento interior");
    const exteriorPrice = optionalPrice(req.body.exteriorPrice ?? existing.exterior_price, "de sesión exterior");
    const exteriorExtra = optionalPrice(req.body.exteriorExtraPrice ?? existing.exterior_extra_hour, "por hora adicional");
    const exteriorMaintenance = optionalPrice(req.body.exteriorMaintenance ?? existing.exterior_maintenance, "de mantenimiento exterior");
    const active = req.body.active === undefined ? existing.active : ([true, 1, "1", "true"].includes(req.body.active) ? 1 : 0);
    const previousImages = JSON.parse(existing.images || "[]");
    let keptImages = previousImages;
    if (req.body.existingImages !== undefined) {
      let requestedImages;
      try { requestedImages = JSON.parse(req.body.existingImages); } catch { throw new Error("No se pudo interpretar el orden de las fotos."); }
      if (!Array.isArray(requestedImages) || requestedImages.some((image) => !previousImages.includes(image))) throw new Error("La galería contiene una foto no válida.");
      keptImages = [...new Set(requestedImages)];
    }
    const newImages = (req.files?.images || []).map((file) => `/uploads/${file.filename}`);
    const images = [...keptImages, ...newImages];
    let sizeGuideImage = existing.size_guide_image || "";
    const removeSizeGuideImage = ["1", "true"].includes(String(req.body.removeSizeGuideImage || "").toLowerCase());
    const newSizeGuideFile = req.files?.sizeGuideImage?.[0];
    if (removeSizeGuideImage) sizeGuideImage = "";
    if (newSizeGuideFile) sizeGuideImage = `/uploads/${newSizeGuideFile.filename}`;
    if (!images.length) throw new Error("El vestido debe conservar al menos una foto.");
    if (!DRESS_CATEGORIES.includes(category)) throw new Error("Selecciona una categoría válida.");
    db.prepare(`UPDATE dresses SET name=?,category=?,color=?,description=?,size_label=?,size_range=?,size_guide_json=?,size_guide_image=?,purchase_cost=?,rent_price=?,included_hours=?,extra_hour_price=?,interior_price=?,interior_extra_30m=?,interior_maintenance=?,exterior_price=?,exterior_extra_hour=?,exterior_maintenance=?,images=?,active=? WHERE id=?`)
      .run(name, category, color, description, sizeLabel, sizeRange, sizeGuideJson, sizeGuideImage, purchaseCost, exteriorPrice, 2, exteriorExtra, interiorPrice, interiorExtra, interiorMaintenance, exteriorPrice, exteriorExtra, exteriorMaintenance, JSON.stringify(images), active, req.params.id);
    for (const removed of previousImages.filter((image) => !keptImages.includes(image) && image.startsWith("/uploads/"))) {
      const target = path.join(PUBLIC_DIR, removed.replace(/^\//, ""));
      if (target.startsWith(path.join(PUBLIC_DIR, "uploads")) && existsSync(target)) {
        try { unlinkSync(target); } catch {}
      }
    }
    if (existing.size_guide_image && existing.size_guide_image !== sizeGuideImage && existing.size_guide_image.startsWith("/uploads/")) {
      const target = path.join(PUBLIC_DIR, existing.size_guide_image.replace(/^\//, ""));
      if (target.startsWith(path.join(PUBLIC_DIR, "uploads")) && existsSync(target)) {
        try { unlinkSync(target); } catch {}
      }
    }
    res.json({ dress: adminDress(db.prepare("SELECT * FROM dresses WHERE id=?").get(req.params.id)) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get("/api/admin/bookings", requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT b.*, d.name AS dress_name, d.color AS dress_color
    FROM bookings b JOIN dresses d ON d.id=b.dress_id
    ORDER BY CASE b.status WHEN 'requested' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END, b.booking_date ASC, b.start_time ASC`).all();
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
    startTime: row.start_time || "10:00",
    endTime: bookingEndTime(row.start_time || "10:00", row.duration_minutes || row.hours * 60),
    hours: row.hours,
    durationMinutes: row.duration_minutes || row.hours * 60,
    sessionType: row.session_type || "exterior",
    gross: row.gross,
    status: row.status,
    paymentStatus: row.payment_status || "pending",
    paidAt: row.paid_at,
    vat: row.vat,
    helperCost: row.helper_cost,
    maintenance: row.maintenance,
    maintenanceExpense: row.maintenance_expense || 0,
    notes: row.notes || "",
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
    const startTime = validateTime(req.body?.startTime || "10:00");
    const sessionType = cleanText(req.body?.sessionType, 20);
    const durationMinutes = Number(req.body?.durationMinutes);
    const paymentStatus = cleanText(req.body?.paymentStatus || "pending", 20);
    const notes = cleanText(req.body?.notes, 1000);
    if (studioName.length < 2) throw new Error("Añade el estudio fotográfico o fotógrafo.");
    if (!["interior", "exterior"].includes(sessionType)) throw new Error("Selecciona el tipo de sesión.");
    if (!["pending", "paid"].includes(paymentStatus)) throw new Error("Selecciona un estado de cobro válido.");
    if (!hasSessionTariff(dress, sessionType)) throw new Error("Define primero toda la tarifa de esta sesión para el vestido.");
    if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 720 || durationMinutes % 30 !== 0) throw new Error("Selecciona una duración válida en bloques de 30 minutos.");
    if (hasBookingConflict(dress.id, date, startTime, durationMinutes)) return res.status(409).json({ error: "Ese vestido ya está ocupado en ese horario." });
    const economics = calculateRental(dress, sessionType, durationMinutes);
    const id = randomUUID();
    db.prepare(`INSERT INTO bookings
      (id,dress_id,customer_name,phone,booking_date,hours,gross,status,vat,helper_cost,maintenance,session_type,studio_name,contact_name,duration_minutes,start_time,payment_status,paid_at,notes,created_at)
      VALUES (@id,@dressId,@customerName,@phone,@date,@hours,@gross,'completed',@vat,@helper,@maintenance,@sessionType,@studioName,@contactName,@durationMinutes,@startTime,@paymentStatus,@paidAt,@notes,@createdAt)`)
      .run({
        id, dressId: dress.id, customerName: contactName || studioName, phone, date, hours: Math.ceil(durationMinutes / 60),
        gross: economics.gross, vat: economics.vat, helper: economics.helperCost, maintenance: economics.maintenance,
        sessionType, studioName, contactName, durationMinutes, startTime, paymentStatus,
        paidAt: paymentStatus === "paid" ? new Date().toISOString() : null, notes, createdAt: new Date().toISOString(),
      });
    res.status(201).json({ id });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.patch("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  try {
    const booking = db.prepare("SELECT * FROM bookings WHERE id=?").get(req.params.id);
    if (!booking) return res.status(404).json({ error: "No encontramos esa sesión." });
    const dressId = cleanText(req.body?.dressId ?? booking.dress_id, 100);
    const dress = db.prepare("SELECT * FROM dresses WHERE id=?").get(dressId);
    if (!dress) return res.status(404).json({ error: "No encontramos el vestido de esta sesión." });
    const studioName = cleanText(req.body?.studioName ?? booking.studio_name, 120);
    const contactName = cleanText(req.body?.contactName ?? booking.contact_name, 100);
    const phone = cleanText(req.body?.phone ?? booking.phone, 40);
    const date = validateDate(req.body?.date ?? booking.booking_date, true);
    const startTime = validateTime(req.body?.startTime ?? booking.start_time ?? "10:00");
    const sessionType = cleanText(req.body?.sessionType ?? booking.session_type, 20);
    const durationMinutes = Number(req.body?.durationMinutes ?? booking.duration_minutes);
    const paymentStatus = cleanText(req.body?.paymentStatus ?? booking.payment_status ?? "pending", 20);
    const notes = cleanText(req.body?.notes ?? booking.notes, 1000);
    if (studioName.length < 2) throw new Error("Añade el estudio fotográfico o fotógrafo.");
    if (!["interior", "exterior"].includes(sessionType)) throw new Error("Selecciona el tipo de sesión.");
    if (!["pending", "paid", "unverified"].includes(paymentStatus)) throw new Error("Selecciona un estado de cobro válido.");
    if (booking.status !== "completed" && paymentStatus === "paid") throw new Error("Solo una sesión realizada puede marcarse como cobrada.");
    if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 720 || durationMinutes % 30 !== 0) throw new Error("Selecciona una duración válida en bloques de 30 minutos.");
    if (booking.status !== "cancelled" && hasBookingConflict(dressId, date, startTime, durationMinutes, booking.id)) return res.status(409).json({ error: "Ese vestido ya está ocupado en ese horario." });
    const gross = req.body?.gross === undefined ? Number(booking.gross) : validMoney(req.body.gross, "cobrado");
    const helperCost = req.body?.helperCost === undefined ? Number(booking.helper_cost) : validMoney(req.body.helperCost, "de ayudante");
    const maintenance = req.body?.maintenance === undefined ? Number(booking.maintenance) : validMoney(req.body.maintenance, "de lavandería / mantenimiento");
    const maintenanceExpense = req.body?.maintenanceExpense === undefined ? Number(booking.maintenance_expense || 0) : validMoney(req.body.maintenanceExpense, "de gasto real de mantenimiento");
    const vatRate = Number(getSettings().vat_rate);
    const vat = gross - gross / (1 + vatRate);
    const paidAt = paymentStatus === "paid" ? (booking.paid_at || new Date().toISOString()) : null;
    db.prepare(`UPDATE bookings SET dress_id=?,customer_name=?,phone=?,booking_date=?,hours=?,gross=?,vat=?,helper_cost=?,maintenance=?,maintenance_expense=?,session_type=?,studio_name=?,contact_name=?,duration_minutes=?,start_time=?,payment_status=?,paid_at=?,notes=? WHERE id=?`)
      .run(dressId, contactName || studioName, phone, date, Math.ceil(durationMinutes / 60), gross, vat, helperCost, maintenance, maintenanceExpense, sessionType, studioName, contactName, durationMinutes, startTime, paymentStatus, paidAt, notes, booking.id);
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.patch("/api/admin/bookings/:id/status", requireAdmin, (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id=?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "No encontramos esa solicitud." });
  const nextStatus = cleanText(req.body?.status, 20);
  const transitions = { requested: ["confirmed", "cancelled"], confirmed: ["completed", "cancelled"], completed: ["confirmed"] };
  if (!transitions[booking.status]?.includes(nextStatus)) return res.status(400).json({ error: "Ese cambio de estado no está permitido." });
  if (booking.status === "completed" && booking.payment_status === "paid") {
    return res.status(400).json({ error: "Marca primero el cobro como pendiente antes de reabrir la sesión." });
  }
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

app.delete("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const result = db.prepare("DELETE FROM bookings WHERE id=?").run(req.params.id);
  if (result.changes !== 1) return res.status(404).json({ error: "No encontramos esa reserva. Actualiza la agenda." });
  res.json({ ok: true });
});

app.get("/api/admin/export/bookings.csv", requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT b.*, d.name AS dress_name FROM bookings b JOIN dresses d ON d.id=b.dress_id ORDER BY b.booking_date,b.start_time`).all();
  const header = ["Fecha","Inicio","Fin","Estudio / fotógrafo","Contacto","Teléfono","Vestido","Tipo","Duración (min)","Estado sesión","Estado cobro","Importe bruto","IVA","Ayudante","Fondo reservado","Gasto real de mantenimiento","Notas"];
  const lines = rows.map((row) => [
    row.booking_date, row.start_time || "10:00", bookingEndTime(row.start_time || "10:00", row.duration_minutes || 120),
    row.studio_name || row.customer_name, row.contact_name, row.phone, row.dress_name, row.session_type,
    row.duration_minutes, row.status, row.payment_status || "pending", Number(row.gross).toFixed(2), Number(row.vat).toFixed(2),
    Number(row.helper_cost).toFixed(2), Number(row.maintenance).toFixed(2), Number(row.maintenance_expense || 0).toFixed(2), row.notes || "",
  ].map(csvCell).join(","));
  const csv = "\ufeff" + [header.map(csvCell).join(","), ...lines].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="tul-en-foco-reservas-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

app.get("/api/admin/export/finance.csv", requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT b.*, d.name AS dress_name
    FROM bookings b JOIN dresses d ON d.id=b.dress_id
    WHERE b.status='completed'
    ORDER BY b.booking_date,b.start_time`).all();
  const header = ["Fecha","Vestido","Estudio / fotógrafo","Estado cobro","Bruto","IVA","Base sin IVA","Ayudante real","Fondo previsto","Fondo cobrado","Gasto real de mantenimiento","Saldo efectivo del fondo","Beneficio de la sesión","Mitad por socio"];
  const lines = rows.map((row) => {
    const gross = Number(row.gross || 0);
    const vat = Number(row.vat || 0);
    const helper = Number(row.helper_cost || 0);
    const maintenance = Number(row.maintenance || 0);
    const collectedFund = row.payment_status === "paid" ? maintenance : 0;
    const maintenanceExpense = Number(row.maintenance_expense || 0);
    const profit = gross - vat - helper - maintenance;
    return [
      row.booking_date, row.dress_name, row.studio_name || row.customer_name, row.payment_status || "pending",
      gross.toFixed(2), vat.toFixed(2), (gross - vat).toFixed(2), helper.toFixed(2), maintenance.toFixed(2), collectedFund.toFixed(2), maintenanceExpense.toFixed(2), (collectedFund - maintenanceExpense).toFixed(2),
      profit.toFixed(2), (profit / 2).toFixed(2),
    ].map(csvCell).join(",");
  });
  const csv = "\ufeff" + [header.map(csvCell).join(","), ...lines].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="tul-en-foco-finanzas-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

app.get("/api/admin/backup.zip", requireAdmin, async (_req, res, next) => {
  const tempDb = path.join(DATA_DIR, `backup-${randomUUID()}.sqlite`);
  const cleanup = () => { if (existsSync(tempDb)) { try { unlinkSync(tempDb); } catch {} } };
  try {
    await db.backup(tempDb);
    const zip = new yazl.ZipFile();
    zip.addFile(tempDb, "data/dressmanager.sqlite");
    for (const entry of collectUploadEntries(path.join(PUBLIC_DIR, "uploads"))) zip.addFile(entry.path, entry.name);
    const manifest = {
      createdAt: new Date().toISOString(),
      contents: ["data/dressmanager.sqlite", "public/uploads/"],
      note: "Incluye la base de datos y las fotos subidas desde el panel. Las imágenes incluidas en el código fuente se recuperan desde el repositorio.",
    };
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), "README-backup.json");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="tul-en-foco-backup-${new Date().toISOString().slice(0,10)}.zip"`);
    let failed = false;
    const handleZipError = (error) => {
      if (failed) return;
      failed = true;
      zip.outputStream.unpipe(res);
      zip.outputStream.destroy();
      cleanup();
      if (res.headersSent) res.destroy(error);
      else next(error);
    };
    zip.on("error", handleZipError);
    zip.outputStream.on("error", handleZipError);
    res.on("close", () => { if (!res.writableFinished) zip.outputStream.destroy(); cleanup(); });
    zip.outputStream.pipe(res);
    zip.end();
  } catch (error) { cleanup(); next(error); }
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

app.listen(port, process.env.HOST || (isProduction ? "0.0.0.0" : "127.0.0.1"), () => {
  console.log(`Tul en Foco API disponible en http://127.0.0.1:${port}`);
});
