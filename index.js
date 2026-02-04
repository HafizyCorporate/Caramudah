import express from "express";
import multer from "multer";
import Tesseract from "tesseract.js";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import bcrypt from "bcrypt";
import session from "express-session";
import sqlite3 from "sqlite3";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.1-70b-versatile";

// ===== DATABASE =====
const db = new sqlite3.Database("database.db");

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  soal TEXT,
  jawaban TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(session({
  secret: "scan-soal-secret",
  resave: false,
  saveUninitialized: false
}));

// ===== STORAGE =====
const upload = multer({ dest: "uploads/" });

// ===== REGISTER =====
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users (email, password) VALUES (?,?)",
    [email, hash],
    err => err ? res.status(400).json({ error: "User sudah ada" }) : res.json({ success: true })
  );
});

// ===== LOGIN =====
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email=?", [email], async (err, user) => {
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: "Login gagal" });
    req.session.user = user;
    res.json({ success: true });
  });
});

// ===== PROCESS =====
app.post("/process", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ error: "Harus login" });
    if (!req.files.length) return res.json({ soal: "", jawaban: "Tidak ada gambar." });

    let soal = "";

    for (const f of req.files) {
      const fixed = `processed/${f.filename}.jpg`;
      await sharp(f.path).rotate().grayscale().normalize().toFile(fixed);
      const ocr = await Tesseract.recognize(fixed, "ind+eng");
      soal += "\n" + ocr.data.text;
      fs.unlinkSync(f.path);
      fs.unlinkSync(fixed);
    }

    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: "Kamu adalah asisten guru." },
          { role: "user", content: soal }
        ],
        temperature: 0.2
      })
    });

    const ai = await groq.json();
    const jawaban = ai.choices[0].message.content;

    db.run(
      "INSERT INTO history (user_id, soal, jawaban) VALUES (?,?,?)",
      [req.session.user.id, soal, jawaban]
    );

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: "SOAL", heading: HeadingLevel.HEADING_1 }),
          new Paragraph(soal),
          new Paragraph({ text: "JAWABAN", heading: HeadingLevel.HEADING_1 }),
          new Paragraph(jawaban)
        ]
      }]
    });

    fs.writeFileSync("hasil.docx", await Packer.toBuffer(doc));

    res.json({ soal, jawaban, download: "/download" });
  } catch {
    res.status(500).json({ error: "Gagal proses" });
  }
});

app.get("/download", (req, res) => res.download("hasil.docx"));
app.listen(PORT, () => console.log("🔥 FULL SYSTEM READY"));
