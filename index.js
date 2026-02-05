import express from "express";
import session from "express-session";
import SQLiteStore from "connect-sqlite3";
import multer from "multer";
import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { GroqAI } from "groqai-sdk"; // ganti sesuai versi SDK
import { Document, Packer, Paragraph } from "docx";

const app = express();
const PORT = process.env.PORT || 3000;

// Body & static
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Session
app.use(session({
  store: new (SQLiteStore(session))({ db: "sessions.db" }),
  secret: "secretkey",
  resave: false,
  saveUninitialized: true
}));

// Database
const db = new sqlite3.Database("./database.db");
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password TEXT)");
});

// Upload folders
["uploads","processed"].forEach(folder => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
});

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "./uploads"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Groq AI init
const ai = new GroqAI({ apiKey: process.env.GROQ_API_KEY });

// Routes

// REGISTER
app.post("/register", (req,res) => {
  const { email, password } = req.body;
  db.run("INSERT INTO users(email,password) VALUES(?,?)", [email,password], err => {
    res.json({ success: !err, message: err ? err.message : "Berhasil daftar!" });
  });
});

// LOGIN
app.post("/login", (req,res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email=? AND password=?", [email,password], (err,row)=>{
    if(row) req.session.user = row.id;
    res.json({ success: !!row, message: row ? "Login berhasil" : "Email/password salah" });
  });
});

// FORGOT PASSWORD
app.post("/forgot-password", (req,res)=>{
  const { email } = req.body;
  db.get("SELECT password FROM users WHERE email=?", [email], (err,row)=>{
    res.json({ success: !!row, password: row ? row.password : null, message: row ? "Password ditemukan" : "Email tidak terdaftar" });
  });
});

// UPLOAD & PROCESS IMAGE
app.post("/process", upload.array("files",5), async (req,res)=>{
  try{
    const files = req.files;
    if(!files || !files.length) return res.json({ success:false, message:"File kosong" });

    let soalText = "";
    for(const f of files){
      // Proses ke Groq AI
      const txt = await ai.extractTextFromImage(fs.readFileSync(f.path)); 
      soalText += txt + "\n";
      fs.renameSync(f.path, path.join("processed", path.basename(f.path))); // pindah file
    }

    // Dummy parsing: AI bikin pilihan ganda & essay
    const soal = { pilihan_ganda: soalText.slice(0,200), essay: soalText.slice(200,400) };
    res.json({ success:true, soal });
  }catch(e){
    res.json({ success:false, message:e.message });
  }
});

// EXPORT WORD
app.post("/export-word", async (req,res)=>{
  const { soal, jawaban } = req.body;
  const doc = new Document();
  doc.addSection({ children:[
    new Paragraph("SOAL:"),
    new Paragraph(soal || ""),
    new Paragraph("JAWABAN:"),
    new Paragraph(jawaban || "")
  ]});
  const buffer = await Packer.toBuffer(doc);
  res.setHeader("Content-Disposition","attachment; filename=soal.docx");
  res.send(buffer);
});

app.listen(PORT, ()=>console.log("Server jalan di "+PORT));
