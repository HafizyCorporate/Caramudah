import express from "express";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import multer from "multer";
import fs from "fs";
import path from "path";
import Docx from "docx"; // Perbaikan CommonJS docx
const { Document, Packer, Paragraph, TextRun } = Docx;

import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Session SQLite =====
const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({
  store: new SQLiteStore({ db: "session.db", dir: "./" }),
  secret: "secret123",
  resave: false,
  saveUninitialized: true
}));

// ===== Static files =====
app.use(express.static("public"));
app.use(bodyParser.json());

// ===== Upload folders =====
const folders = ["uploads", "processed"];
folders.forEach(f=>{
  if(!fs.existsSync(f)) fs.mkdirSync(f);
});

// ===== Multer =====
const storage = multer.diskStorage({
  destination: function(req,file,cb){ cb(null,"uploads"); },
  filename: function(req,file,cb){ cb(null, Date.now()+"_"+file.originalname); }
});
const upload = multer({storage});

// ===== Dummy Users =====
let users = [];

// ===== Routes =====

// --- Login ---
app.post("/login", (req,res)=>{
  const {email,password} = req.body;
  const u = users.find(u=>u.email===email && u.password===password);
  if(u) res.json({ok:true});
  else res.json({ok:false,error:"Email atau password salah"});
});

// --- Register ---
app.post("/register",(req,res)=>{
  const {email,password} = req.body;
  if(users.find(u=>u.email===email)) return res.json({ok:false,error:"Email sudah terdaftar"});
  users.push({email,password});
  res.json({ok:true});
});

// --- Forgot Password ---
app.post("/forgot",(req,res)=>{
  const {email} = req.body;
  const u = users.find(u=>u.email===email);
  if(u) res.json({ok:true}); // kirim email bisa ditambahkan
  else res.json({ok:false,error:"Email tidak ditemukan"});
});

// --- Process Image to Soal (Dummy AI / Groq) ---
app.post("/process", upload.single("file"), async (req,res)=>{
  const pgCount = parseInt(req.body.pg) || 2;
  const essayCount = parseInt(req.body.essay) || 2;

  // Contoh dummy AI Groq
  const pg = [];
  for(let i=1;i<=pgCount;i++){
    pg.push({pertanyaan:`Soal Pilihan Ganda ${i}`,jawaban:"Jawaban"});
  }
  const essay = [];
  for(let i=1;i<=essayCount;i++){
    essay.push({pertanyaan:`Soal Essay ${i}`,jawaban:"Jawaban"});
  }

  res.json({pg,essay});
});

// --- Export Word ---
app.get("/export-word", async (req,res)=>{
  const doc = new Document();
  doc.addSection({
    children:[
      new Paragraph({children:[new TextRun("Soal Pilihan Ganda")]}),
      new Paragraph({children:[new TextRun("Jawaban PG")]}),
      new Paragraph({children:[new TextRun("Soal Essay")]}),
      new Paragraph({children:[new TextRun("Jawaban Essay")]})
    ]
  });

  const b64 = await Packer.toBase64String(doc);
  const fileName = "soal.docx";
  res.setHeader("Content-Disposition",`attachment; filename=${fileName}`);
  res.send(Buffer.from(b64,"base64"));
});

// ===== Start Server =====
app.listen(PORT, ()=>console.log("Server jalan di port "+PORT));
