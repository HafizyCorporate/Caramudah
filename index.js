import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import Tesseract from "tesseract.js";
import fetch from "node-fetch";
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from "docx";
import sqlite3 from "sqlite3";
import session from "express-session";
import bcrypt from "bcrypt";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ===== SESSION ===== */
app.use(session({
  secret:"supersecretkey",
  resave:false,
  saveUninitialized:true
}));

/* ===== DATABASE ===== */
const db = new sqlite3.Database("database.db");
db.serialize(()=>{
  db.run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT
  )`);
});

/* ===== FOLDER UPLOAD ===== */
["uploads","processed"].forEach(dir=>{
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
});

const storage = multer.diskStorage({
  destination: (req,file,cb)=>{ cb(null,"uploads"); },
  filename: (req,file,cb)=>{ cb(null,Date.now()+"_"+file.originalname); }
});
const upload = multer({storage});

/* ===== GROQ API via fetch ===== */
async function sendToGroq(text){
  const res = await fetch("https://api.groq.ai/v1/chat/completions",{
    method:"POST",
    headers:{
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({
      model:"gpt-4o-mini",
      messages:[
        {role:"system",content:`Kamu asisten guru. Rapikan teks hasil OCR menjadi soal pilihan ganda & essay. Keluarkan JSON: {"soal":"...","jawaban":"..."}`},
        {role:"user",content:text}
      ],
      temperature:0.2,
      max_tokens:800
    })
  });
  const data = await res.json();
  if(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content){
    try{
      return JSON.parse(data.choices[0].message.content);
    }catch{
      return {soal:text,jawaban:"Jawaban tidak bisa ditentukan"};
    }
  }
  return {soal:text,jawaban:"Jawaban tidak bisa ditentukan"};
}

function cleanOCR(text){
  return text.replace(/\n{2,}/g,"\n").replace(/[|]/g,"").replace(/\s{2,}/g," ").trim();
}

/* ===== AUTH ===== */
app.post("/register", async (req,res)=>{
  const {email,password}=req.body;
  if(!email || !password) return res.json({error:"Email & Password dibutuhkan"});
  const hash = await bcrypt.hash(password,10);
  db.run("INSERT INTO users(email,password) VALUES(?,?)",[email,hash],function(err){
    if(err) return res.json({error:"Email sudah terdaftar"});
    res.json({success:true});
  });
});

app.post("/login", (req,res)=>{
  const {email,password}=req.body;
  db.get("SELECT * FROM users WHERE email=?",[email],async (err,row)=>{
    if(!row) return res.json({error:"Email tidak terdaftar"});
    const match = await bcrypt.compare(password,row.password);
    if(!match) return res.json({error:"Password salah"});
    req.session.user=row.id;
    res.json({success:true});
  });
});

app.post("/forgot-password",(req,res)=>{
  const {email}=req.body;
  // TODO: kirim email reset password
  res.json({success:true});
});

/* ===== UPLOAD ===== */
app.post("/upload",upload.array("images",5),(req,res)=>{
  if(!req.files) return res.json({success:false});
  res.json({success:true,files:req.files.map(f=>({filename:f.filename}))});
});

/* ===== PROCESS AI ===== */
app.post("/process-ai", async (req,res)=>{
  try{
    const {files} = req.body;
    if(!files || files.length===0) return res.json({soal:"",jawaban:""});
    let fullText="";
    for(const f of files){
      const filePath = path.join("uploads",f);
      if(fs.existsSync(filePath)){
        const result = await Tesseract.recognize(filePath,"ind+eng");
        fullText+="\n"+(result.data.text||"");
      }
    }
    const cleaned = cleanOCR(fullText);
    const aiResult = await sendToGroq(cleaned);
    res.json(aiResult);
  }catch(err){
    console.error(err);
    res.json({soal:"",jawaban:"Gagal memproses AI"});
  }
});

/* ===== DOWNLOAD WORD ===== */
app.get("/download", async (req,res)=>{
  try{
    const doc = new Document({
      sections:[{
        children:[
          new Paragraph({text:"SOAL",heading:HeadingLevel.HEADING_1}),
          new Paragraph({text:"Preview Soal"}),
          new Paragraph({children:[new PageBreak()]}),
          new Paragraph({text:"JAWABAN",heading:HeadingLevel.HEADING_1}),
          new Paragraph({text:"Preview Jawaban"})
        ]
      }]
    });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync("hasil.docx",buffer);
    res.download("hasil.docx","hasil-soal-jawaban.docx");
  }catch(err){ res.status(500).send("Gagal download Word"); }
});

/* ===== START SERVER ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Server running on port "+PORT));
