import express from "express";
import session from "express-session";
import SQLiteStore from "connect-sqlite3";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Document, Packer, Paragraph, TextRun } from "docx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Membuat folder jika belum ada
["uploads", "processed"].forEach((dir) => {
  if (!fs.existsSync(path.join(__dirname, dir))) fs.mkdirSync(path.join(__dirname, dir));
});

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// Session SQLite
app.use(session({
  store: new (SQLiteStore(session))({ db: "sessions.sqlite" }),
  secret: "secret123",
  resave: false,
  saveUninitialized: true
}));

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mock database
let users = [];

// ===== AUTH ROUTES =====
app.post("/register", (req, res) => {
  const { email, password } = req.body;
  if(users.find(u => u.email === email)) return res.json({ success:false, message:"Email sudah terdaftar" });
  users.push({ email, password });
  res.json({ success:true });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if(user){
    req.session.user = email;
    res.json({ success:true });
  } else res.json({ success:false, message:"Email/Password salah" });
});

app.post("/reset", (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if(user){
    user.password = password;
    res.json({ success:true });
  } else res.json({ success:false, message:"Email tidak ditemukan" });
});

// ===== UPLOAD & AI MOCK =====
app.post("/upload", upload.single("file"), async (req, res) => {
  const mcCount = parseInt(req.body.mc) || 2;
  const essayCount = parseInt(req.body.essay) || 2;

  // Mock AI processing (ganti nanti Groq AI SDK)
  const mc = Array.from({length: mcCount}, (_, i) => `Soal PG ${i+1} - jawaban otomatis`);
  const essay = Array.from({length: essayCount}, (_, i) => `Soal Essay ${i+1} - jawaban otomatis`);

  res.json({ success:true, mc, essay });
});

// ===== EXPORT DOCX =====
app.post("/export-word", async (req, res) => {
  const { mc, essay } = req.body;
  const doc = new Document();

  doc.addSection({
    children: [
      new Paragraph({ text: "=== PILIHAN GANDA ===", bold:true }),
      ...mc.map(q => new Paragraph(q)),
      new Paragraph({ text: "=== ESSAY ===", bold:true }),
      ...essay.map(q => new Paragraph(q))
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  res.setHeader("Content-Disposition", "attachment; filename=soal.docx");
  res.send(buffer);
});

app.listen(PORT, () => console.log(`Server running di http://localhost:${PORT}`));
