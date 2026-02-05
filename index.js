import express from "express";
import cors from "cors";
import multer from "multer";
import Tesseract from "tesseract.js";
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from "docx";
import fs from "fs";
import path from "path";
import session from "express-session";
import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// --- SESSION ---
app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: true,
  })
);

// --- DATABASE ---
const db = new sqlite3.Database("./database.db");
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT
    )`
  );
});

// --- FOLDER ---
["uploads", "processed"].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// --- MULTER ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// --- MOCK AI FUNCTION (replace with GroqAI real API) ---
async function processTextOCR(text) {
  // Pisahkan PG dan Essay mock
  const soalPG = `1. Contoh soal PG?\nA. Jawaban 1\nB. Jawaban 2\nC. Jawaban 3\nD. Jawaban 4`;
  const jawabanPG = "A";
  const soalEssay = "2. Contoh soal essay: Jelaskan...";
  const jawabanEssay = "Jawaban essay singkat.";
  return { soalPG, jawabanPG, soalEssay, jawabanEssay };
}

// --- CLEAN OCR ---
function cleanOCR(text) {
  return text.replace(/\n{2,}/g, "\n").replace(/[|]/g, "").replace(/\s{2,}/g, " ").trim();
}

// --- UPLOAD & PROCESS ---
app.post("/upload", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Tidak ada file yang diupload" });
    }

    let fullText = "";
    for (const file of req.files) {
      const result = await Tesseract.recognize(file.path, "ind+eng");
      fullText += "\n" + (result.data.text || "");
      fs.unlinkSync(file.path); // hapus file setelah OCR
    }

    const cleanedText = cleanOCR(fullText);
    const aiResult = await processTextOCR(cleanedText);

    // buat DOCX
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "SOAL PG", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(aiResult.soalPG),
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({ text: "JAWABAN PG", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(aiResult.jawabanPG),
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({ text: "SOAL ESSAY", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(aiResult.soalEssay),
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({ text: "JAWABAN ESSAY", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(aiResult.jawabanEssay),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync("processed/hasil.docx", buffer);

    res.json({ success: true, aiResult });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: "Gagal memproses gambar / AI error" });
  }
});

// --- DOWNLOAD WORD ---
app.get("/download", (req, res) => {
  const filePath = path.resolve("processed/hasil.docx");
  if (!fs.existsSync(filePath)) return res.status(404).send("File belum tersedia");
  res.download(filePath, "hasil-soal-jawaban.docx");
});

// --- LOGIN ---
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, row) => {
    if (err) return res.status(500).json({ error: "Database error" });
    if (!row) return res.status(401).json({ error: "Email tidak ditemukan" });
    const match = await bcrypt.compare(password, row.password);
    if (!match) return res.status(401).json({ error: "Password salah" });
    req.session.user = { id: row.id, email: row.email };
    res.json({ success: true });
  });
});

// --- REGISTER ---
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  db.run("INSERT INTO users (email, password) VALUES (?, ?)", [email, hashed], function (err) {
    if (err) return res.status(500).json({ error: "Email sudah terdaftar" });
    res.json({ success: true });
  });
});

// --- FORGOT PASSWORD (placeholder) ---
app.post("/forgot", (req, res) => {
  const { email } = req.body;
  // di sini tinggal connect ke email service
  console.log("Forgot password for:", email);
  res.json({ success: true, message: "Cek email untuk reset password" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
