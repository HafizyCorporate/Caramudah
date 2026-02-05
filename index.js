import express from "express";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import multer from "multer";
import fs from "fs";
import path from "path";
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from "docx";
import sqlite3 from "sqlite3";

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

// === SESSION SETUP ===
app.use(session({
  store: new SQLiteStore({ db: "sessions.db", dir: "./" }),
  secret: "supersecretkey",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000*60*60*24 }
}));

app.use(express.json());
app.use(express.static("public"));

// === CREATE FOLDERS IF NOT EXIST ===
["uploads","processed"].forEach(f=>{
  if(!fs.existsSync(f)) fs.mkdirSync(f);
});

// === DATABASE SETUP ===
const db = new sqlite3.Database("./database.db");
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password TEXT
)`);

// === AUTH MIDDLEWARE ===
function authMiddleware(req,res,next){
  if(req.session.user) next();
  else res.status(401).json({error:"Not logged in"});
}

// === ROUTES ===

// REGISTER
app.post("/register",(req,res)=>{
  const {email,password}=req.body;
  db.run("INSERT INTO users(email,password) VALUES(?,?)",[email,password],function(err){
    if(err) return res.json({error:"Email sudah terdaftar"});
    res.json({message:"Berhasil register"});
  });
});

// LOGIN
app.post("/login",(req,res)=>{
  const {email,password}=req.body;
  db.get("SELECT * FROM users WHERE email=? AND password=?",[email,password],(err,row)=>{
    if(err) return res.json({error:"Terjadi error"});
    if(row){
      req.session.user={id: row.id, email: row.email};
      res.json({message:"Login sukses"});
    } else {
      res.json({error:"Email atau password salah"});
    }
  });
});

// LOGOUT
app.post("/logout",(req,res)=>{
  req.session.destroy(()=>res.json({message:"Logout sukses"}));
});

// FORGOT PASSWORD
app.post("/forgot",(req,res)=>{
  const {email}=req.body;
  const newPass=Math.random().toString(36).slice(-8);
  db.run("UPDATE users SET password=? WHERE email=?",[newPass,email],function(err){
    if(err) return res.json({error:"Terjadi error"});
    if(this.changes===0) return res.json({error:"Email tidak ditemukan"});
    console.log(`Password baru untuk ${email} adalah ${newPass}`);
    res.json({message:"Password baru dikirim ke email (cek console untuk testing)"});
  });
});

// CHECK SESSION
app.get("/check-session",(req,res)=>{
  if(req.session.user) res.json({logged:true});
  else res.status(401).json({error:"Not logged in"});
});

// === MULTER UPLOAD SETUP ===
const upload = multer({ dest:"uploads/" });

// === DUMMY AI PROCESS ===
function dummyAIProcess(images, pilihanGandaCount=5, essayCount=2){
  let soal="", jawaban="";
  for(let i=1;i<=pilihanGandaCount;i++){
    soal+=`${i}. Ini soal pilihan ganda contoh?\nA. Opsi 1\nB. Opsi 2\nC. Opsi 3\nD. Opsi 4\n\n`;
    jawaban+=`${i}. A\n`;
  }
  for(let i=1;i<=essayCount;i++){
    soal+=`${pilihanGandaCount+i}. Ini soal essay contoh?\n\n`;
    jawaban+=`${pilihanGandaCount+i}. Jawaban essay singkat\n`;
  }
  return {soal, jawaban};
}

// UPLOAD & PROCESS
app.post("/upload", authMiddleware, upload.array("images",5), async(req,res)=>{
  try{
    if(!req.files || req.files.length===0)
      return res.status(400).json({error:"Tidak ada file"});

    const {pgCount,essayCount} = req.body;
    const result = dummyAIProcess(req.files, Number(pgCount)||5, Number(essayCount)||2);

    // SAVE WORD
    const doc = new Document({
      sections:[{
        children:[
          new Paragraph({text:"SOAL",heading:HeadingLevel.HEADING_1}),
          new Paragraph(result.soal),
          new Paragraph({children:[new PageBreak()]}),
          new Paragraph({text:"JAWABAN",heading:HeadingLevel.HEADING_1}),
          new Paragraph(result.jawaban)
        ]
      }]
    });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync("processed/hasil.docx", buffer);

    res.json({...result, download:"/download"});
  } catch(e){
    console.error(e);
    res.status(500).json({error:"Gagal memproses gambar"});
  }
});

// DOWNLOAD WORD
app.get("/download", authMiddleware,(req,res)=>{
  const filePath = path.resolve("processed","hasil.docx");
  if(!fs.existsSync(filePath)) return res.status(404).send("File belum tersedia");
  res.download(filePath,"hasil-soal-jawaban.docx");
});

// SERVER START
const PORT = process.env.PORT||3000;
app.listen(PORT,()=>console.log("Server berjalan di port "+PORT));
