import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || "");
if (!email || password.length < 12) {
  throw new Error("Pon ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres) en .env antes de continuar.");
}

const user = db.prepare("SELECT id FROM users WHERE email=?").get(email);
const passwordHash = bcrypt.hashSync(password, 12);
if (user) {
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(passwordHash, user.id);
} else {
  db.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)")
    .run(randomUUID(), email, passwordHash, new Date().toISOString());
}
db.prepare("DELETE FROM sessions").run();
console.log(`Acceso de administrador actualizado para ${email}.`);
