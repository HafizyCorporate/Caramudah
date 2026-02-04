const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

/* ================= BASIC ================= */
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ================= SAFE FOLDER (ANTI EEXIST) ================= */
["uploads", "processed"].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/* ================= MULTER ================= */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads"),
    filename: (req, file, cb) =>
      cb(null, Date.now() + "-" + file.originalname)
  })
});

/* ================= DATABASE ================= */
const db = new sqlite3.Database("database.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    token TEXT,
    expires INTEGER
  )`);
});

/* ================= EMAIL SMTP ================= */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/* ================= AUTH ================= */
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users (email,password) VALUES (?,?)",
    [email, hash],
    err => {
      if (err) return res.json({ error: "Email sudah terdaftar" });
      res.json({ success: true });
    }
  );
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email=?", [email], async (err, user) => {
    if (!user) return res.json({ error: "User tidak ditemukan" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.json({ error: "Password salah" });
    res.json({ success: true });
  });
});

/* ================= FORGOT PASSWORD ================= */
app.post("/forgot-password", (req, res) => {
  const { email } = req.body;
  const token = uuidv4();
  const expires = Date.now() + 15 * 60 * 1000;

  db.run(
    "INSERT INTO reset_tokens (email,token,expires) VALUES (?,?,?)",
    [email, token, expires]
  );

  const link = `${req.protocol}://${req.get("host")}/reset.html?token=${token}`;

  transporter.sendMail({
    from: `"Scan Soal AI" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Reset Password",
    html: `<p>Klik link reset password:</p><a href="${link}">${link}</a>`
  });

  res.json({ success: true });
});

/* ================= RESET PASSWORD ================= */
app.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;
  db.get(
    "SELECT * FROM reset_tokens WHERE token=? AND expires>?",
    [token, Date.now()],
    async (err, row) => {
      if (!row) return res.json({ error: "Token tidak valid / expired" });

      const hash = await bcrypt.hash(password, 10);
      db.run("UPDATE users SET password=? WHERE email=?", [
        hash,
        row.email
      ]);
      db.run("DELETE FROM reset_tokens WHERE token=?", [token]);
      res.json({ success: true });
    }
  );
});

/* ================= UPLOAD (DEMO) ================= */
app.post("/upload", upload.array("images", 5), (req, res) => {
  res.json({ success: true, files: req.files });
});

/* ================= START ================= */
app.listen(PORT, () =>
  console.log("SERVER RUNNING ON PORT", PORT)
);
