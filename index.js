import express from "express";
import multer from "multer";
import fs from "fs";
import bcrypt from "bcrypt";
import Database from "better-sqlite3";
import Tesseract from "tesseract.js";
import { Document, Packer, Paragraph } from "docx";

const app = express();
const PORT = process.env.PORT || 3000;

// =======================
// SAFE FOLDER (ANTI EEXIST)
// =======================
for (const dir of ["uploads", "processed"]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
}

// =======================
// MIDDLEWARE
// =======================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// =======================
// DATABASE
// =======================
const db = new Database("database.db");

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password TEXT
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  ocr TEXT,
  ai TEXT
)
`).run();

// =======================
// AUTH
// =======================
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    db.prepare("INSERT INTO users (email, password) VALUES (?,?)")
      .run(email, hash);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Email sudah terdaftar" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!user) return res.status(401).json({ error: "Login gagal" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Login gagal" });

  res.json({ success: true, userId: user.id });
});

// =======================
// UPLOAD
// =======================
const upload = multer({ dest: "uploads/" });

app.post("/upload", upload.single("image"), async (req, res) => {
  const imagePath = req.file.path;

  const result = await Tesseract.recognize(imagePath, "eng");
  const text = result.data.text;

  const aiResult = `
SOAL PILIHAN GANDA:
1. ...

SOAL ESSAY:
1. ...
`;

  res.json({ ocr: text, ai: aiResult });
});

// =======================
// EXPORT WORD
// =======================
app.post("/export", async (req, res) => {
  const { soal } = req.body;

  const doc = new Document({
    sections: [{
      children: soal.split("\n").map(t => new Paragraph(t))
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  res.setHeader("Content-Disposition", "attachment; filename=soal.docx");
  res.send(buffer);
});

app.listen(PORT, () => console.log("RUNNING", PORT));
