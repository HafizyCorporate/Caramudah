import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import session from "express-session";
import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { GroqAI } from "@groqai/sdk";
import Tesseract from "tesseract.js";
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from "docx";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// === SESSION ===
app.use(
  session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: true,
  })
);

// === DATABASE ===
const db = await open({
  filename: "./database.db",
  driver: sqlite3.Database,
});

await db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password TEXT
)
`);

// === FOLDER CHECK ===
["uploads", "processed"].forEach((folder) => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
});

// === MULTER SETUP ===
const upload = multer({ dest: "uploads/" });

// === GROQAI SETUP ===
const groqai = new GroqAI({ apiKey: process.env.GROQ_API_KEY });

// === HELPERS ===
function cleanOCR(text) {
  return text.replace(/\n{2,}/g, "\n").replace(/[|]/g, "").replace(/\s{2,}/g, " ").trim();
}

// === ROUTES ===

// LOGIN
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!user) return res.status(400).json({ error: "Email tidak ditemukan" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: "Password salah" });

  req.session.user = { id: user.id, email: user.email };
  res.json({ success: true });
});

// REGISTER
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  try {
    await db.run("INSERT INTO users (email, password) VALUES (?, ?)", email, hashed);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Email sudah terdaftar" });
  }
});

// FORGOT PASSWORD
app.post("/forgot", async (req, res) => {
  const { email } = req.body;
  const user = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!user) return res.status(400).json({ error: "Email tidak ditemukan" });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  const newPassword = Math.random().toString(36).slice(-8);
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.run("UPDATE users SET password = ? WHERE email = ?", hashed, email);

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Reset Password",
    text: `Password baru Anda: ${newPassword}`,
  });

  res.json({ success: true });
});

// UPLOAD & PROCESS
app.post("/upload", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: "Tidak ada file yang diupload" });

    const { pgCount = 5, essayCount = 2 } = req.body;

    let fullText = "";
    for (const file of req.files) {
      const result = await Tesseract.recognize(file.path, "ind+eng");
      fullText += "\n" + (result.data.text || "");
      fs.renameSync(file.path, path.join("processed", file.filename));
    }

    const cleanedText = cleanOCR(fullText);

    // === GROQAI PROCESS ===
    const aiRes = await groqai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Kamu asisten guru:
1. Rapikan teks OCR menjadi soal PG & essay.
2. PG sebanyak ${pgCount}, essay sebanyak ${essayCount}.
3. Format PG:
   1. Pertanyaan?
      A. ...
      B. ...
      C. ...
      D. ...
4. Essay tulis pertanyaan saja.
5. Keluarkan JSON valid: {"soalPG":[...],"soalEssay":[...],"jawabanPG":[...],"jawabanEssay":[...]}
          `,
        },
        { role: "user", content: cleanedText },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

    let json;
    try {
      json = JSON.parse(aiRes.choices[0].message.content);
    } catch {
      json = {
        soalPG: [],
        soalEssay: [],
        jawabanPG: [],
        jawabanEssay: [],
      };
    }

    // === EXPORT WORD ===
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "SOAL PG", heading: HeadingLevel.HEADING_1 }),
            ...json.soalPG.map((q) => new Paragraph(q)),
            new Paragraph({ text: "SOAL ESSAY", heading: HeadingLevel.HEADING_1 }),
            ...json.soalEssay.map((q) => new Paragraph(q)),
            new Paragraph({ text: "JAWABAN PG", heading: HeadingLevel.HEADING_1 }),
            ...json.jawabanPG.map((a) => new Paragraph(a)),
            new Paragraph({ text: "JAWABAN ESSAY", heading: HeadingLevel.HEADING_1 }),
            ...json.jawabanEssay.map((a) => new Paragraph(a)),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync("hasil.docx", buffer);

    res.json({ ...json, download: "/download" });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: "Gagal memproses gambar / AI error" });
  }
});

// DOWNLOAD WORD
app.get("/download", (req, res) => {
  const filePath = path.resolve("hasil.docx");
  if (!fs.existsSync(filePath)) return res.status(404).send("File belum tersedia");
  res.download(filePath, "hasil-soal-jawaban.docx");
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
