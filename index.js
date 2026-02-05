import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import session from "express-session";
import SQLiteStore from "connect-sqlite3";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { Document, Packer, Paragraph, TextRun } from "docx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- FOLDER ---
const uploadsDir = path.join(__dirname,"uploads");
const processedDir = path.join(__dirname,"processed");
[uploadsDir,processedDir].forEach(d=>{
  if(!fs.existsSync(d)) fs.mkdirSync(d);
});

// --- SESSION ---
app.use(session({
  store: new (SQLiteStore(session))({ db: "sessions.db", dir: __dirname }),
  secret: "secret123",
  resave: false,
  saveUninitialized: true
}));

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname,"public")));

// --- MULTER ---
const storage = multer.diskStorage({
  destination: (req,file,cb)=>cb(null,uploadsDir),
  filename: (req,file,cb)=>cb(null,Date.now()+"-"+file.originalname)
});
const upload = multer({ storage });

// --- SIMULASI GROQ AI (bisa diganti Groq asli) ---
function aiProcessImage(filePath,pgCount=2,essayCount=2){
  // return object pg+essay
  const pg = [], essay=[];
  for(let i=1;i<=pgCount;i++){
    pg.push({ pertanyaan:`PG question ${i}`, jawaban:`Answer ${i}` });
  }
  for(let i=1;i<=essayCount;i++){
    essay.push({ pertanyaan:`Essay question ${i}`, jawaban:`Answer ${i}` });
  }
  return { pg, essay };
}

// --- ROUTES ---
app.post("/process", upload.single("file"), (req,res)=>{
  const pgCount = parseInt(req.body.pg)||2;
  const essayCount = parseInt(req.body.essay)||2;
  const filePath = req.file ? req.file.path : null;

  if(!filePath) return res.status(400).json({ error:"No file" });

  const data = aiProcessImage(filePath,pgCount,essayCount);
  req.session.data = data;
  res.json(data);
});

app.post("/session-store",(req,res)=>{
  req.session.data = req.body;
  res.json({ ok:true });
});

// --- EXPORT WORD ---
app.get("/export-word", async (req,res)=>{
  const doc = new Document();
  const data = req.session.data;
  if(!data) return res.send("No data");

  data.pg.forEach((q,i)=>{
    doc.addSection({ children:[ new Paragraph({ children:[ new TextRun(`${i+1}. ${q.pertanyaan} (Jawaban: ${q.jawaban})`) ] }) ] });
  });
  data.essay.forEach((q,i)=>{
    doc.addSection({ children:[ new Paragraph({ children:[ new TextRun(`${i+1}. ${q.pertanyaan} (Jawaban: ${q.jawaban})`) ] }) ] });
  });

  const buffer = await Packer.toBuffer(doc);
  res.setHeader("Content-Disposition","attachment; filename=soal.docx");
  res.send(buffer);
});

// --- LOGIN / REGISTER / FORGOT ---
import sqlite3 from "sqlite3";
const db = new sqlite3.Database(path.join(__dirname,"database.db"));
db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password TEXT)");

// register
app.post("/register",(req,res)=>{
  const { email,password } = req.body;
  db.run("INSERT INTO users(email,password) VALUES(?,?)",[email,password], function(err){
    if(err) return res.json({ error:err.message });
    res.json({ ok:true });
  });
});

// login
app.post("/login",(req,res)=>{
  const { email,password } = req.body;
  db.get("SELECT * FROM users WHERE email=? AND password=?",[email,password],(err,row)=>{
    if(err) return res.json({ error:err.message });
    if(!row) return res.json({ error:"Login gagal" });
    req.session.user=row;
    res.json({ ok:true });
  });
});

// forgot password (kirim email)
import nodemailer from "nodemailer";
app.post("/forgot",(req,res)=>{
  const { email } = req.body;
  db.get("SELECT * FROM users WHERE email=?",[email], async (err,row)=>{
    if(err) return res.json({ error:err.message });
    if(!row) return res.json({ error:"Email tidak ditemukan" });

    const transporter = nodemailer.createTransport({
      service:"gmail",
      auth:{ user:"YOUR_EMAIL@gmail.com", pass:"YOUR_APP_PASSWORD" }
    });

    const mailOptions = {
      from:"YOUR_EMAIL@gmail.com",
      to:email,
      subject:"Reset Password",
      text:`Password Anda: ${row.password}`
    };

    transporter.sendMail(mailOptions,(err,info)=>{
      if(err) return res.json({ error:err.message });
      res.json({ ok:true });
    });
  });
});

// --- START SERVER ---
app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
