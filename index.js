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

const upload = multer({ dest: "uploads/" });

// ===== AUTH =====
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email=?", [email], async (err, user) => {
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Login gagal" });
    }
    req.session.user = user;
    res.json({ success: true });
  });
});

// ===== PROCESS =====
app.post("/process", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ error: "Harus login" });
    }

    let text = "";

    for (const file of req.files) {
      const processed = `processed/${file.filename}.jpg`;

      await sharp(file.path)
        .rotate()
        .grayscale()
        .normalize()
        .toFile(processed);

      const result = await Tesseract.recognize(processed, "ind+eng");
      text += "\n" + result.data.text;

      fs.unlinkSync(file.path);
      fs.unlinkSync(processed);
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: "Kamu adalah asisten guru." },
          { role: "user", content: text }
        ],
        temperature: 0.2
      })
    });

    const ai = await groqRes.json();
    const jawaban = ai.choices[0].message.content;

    db.run(
      "INSERT INTO history (user_id, soal, jawaban) VALUES (?,?,?)",
      [req.session.user.id, text, jawaban]
    );

    res.json({ soal: text, jawaban });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal proses" });
  }
});

app.listen(PORT, () => console.log("🔥 Server ready di port " + PORT));
