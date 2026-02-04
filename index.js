import express from "express";
import multer from "multer";
import fs from "fs";
import bcrypt from "bcrypt";
import Database from "better-sqlite3";
import Tesseract from "tesseract.js";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import { Document, Packer, Paragraph } from "docx";

const app = express();
const PORT = process.env.PORT || 3000;

/* ================= SAFE FOLDER ================= */
// INI FIX ERROR EEXIST (PALING PENTING)
function ensureDir(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}
ensureDir("uploads");
ensureDir("processed");

/* ================= MIDDLEWARE ================= */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ================= DATABASE ================= */
const db = new Database("database.db");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password TEXT
);

CREATE TABLE IF NOT EXISTS results(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  ocr TEXT,
  ai TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

/* ================= AUTH ================= */
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    db.prepare("INSERT INTO users(email,password) VALUES (?,?)").run(email, hash);
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "Email sudah terdaftar" });
  }
});

app.post("/login", async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(req.body.email);
  if (!user) return res.status(401).json({ error: "Login gagal" });

  const valid = await bcrypt.compare(req.body.password, user.password);
  if (!valid) return res.status(401).json({ error: "Login gagal" });

  res.json({ ok: true, userId: user.id });
});

/* ================= EMAIL RESET ================= */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.post("/forgot", async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(req.body.email);
  if (!user) return res.json({ ok: true });

  const newPass = Math.random().toString(36).slice(-8);
  const hash = await bcrypt.hash(newPass, 10);
  db.prepare("UPDATE users SET password=? WHERE id=?").run(hash, user.id);

  await transporter.sendMail({
    from: "Scan Soal AI",
    to: req.body.email,
    subject: "Reset Password",
    text: `Password baru kamu: ${newPass}`
  });

  res.json({ ok: true });
});

/* ================= UPLOAD ================= */
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, "uploads"),
  filename: (_, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

/* ================= SCAN + GROQ ================= */
app.post("/scan", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;

    const ocrResult = await Tesseract.recognize(imagePath, "eng");
    const text = ocrResult.data.text;

    const groqRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [
            {
              role: "user",
              content:
                "Ubah teks berikut menjadi soal pilihan ganda dan essay lengkap dengan jawaban:\n\n" +
                text
            }
          ]
        })
      }
    );

    const groqData = await groqRes.json();
    const aiText = groqData.choices[0].message.content;

    res.json({ ocr: text, ai: aiText });
  } catch (err) {
    res.status(500).json({ error: "Gagal memproses gambar" });
  }
});

/* ================= EXPORT WORD ================= */
app.post("/export", async (req, res) => {
  const doc = new Document({
    sections: [
      {
        children: req.body.text
          .split("\n")
          .map(t => new Paragraph(t))
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  res.setHeader("Content-Disposition", "attachment; filename=soal.docx");
  res.send(buffer);
});

/* ================= RUN ================= */
app.listen(PORT, () => {
  console.log("SERVER RUNNING ON", PORT);
});
