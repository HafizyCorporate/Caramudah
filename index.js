import express from "express";
import multer from "multer";
import fs from "fs";
import bcrypt from "bcrypt";
import Database from "better-sqlite3";
import Tesseract from "tesseract.js";
import { Document, Packer, Paragraph } from "docx";
import fetch from "node-fetch";
import nodemailer from "nodemailer";

const app = express();
const PORT = process.env.PORT || 3000;

// ===== SAFE FOLDER =====
["uploads","processed"].forEach(d=>{
  if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true});
});

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));

// ===== DATABASE =====
const db=new Database("database.db");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY,
 email TEXT UNIQUE,
 password TEXT
);
CREATE TABLE IF NOT EXISTS results(
 id INTEGER PRIMARY KEY,
 user_id INTEGER,
 ocr TEXT,
 ai TEXT
);
`);

// ===== AUTH =====
app.post("/register",async(req,res)=>{
  const {email,password}=req.body;
  const hash=await bcrypt.hash(password,10);
  try{
    db.prepare("INSERT INTO users(email,password) VALUES(?,?)").run(email,hash);
    res.json({ok:true});
  }catch{
    res.status(400).json({error:"Email sudah ada"});
  }
});

app.post("/login",async(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(req.body.email);
  if(!u) return res.status(401).json({error:"Gagal"});
  const ok=await bcrypt.compare(req.body.password,u.password);
  if(!ok) return res.status(401).json({error:"Gagal"});
  res.json({ok:true,userId:u.id});
});

// ===== FORGOT PASSWORD =====
const transporter=nodemailer.createTransport({
  service:"gmail",
  auth:{
    user:process.env.EMAIL_USER,
    pass:process.env.EMAIL_PASS
  }
});

app.post("/forgot",async(req,res)=>{
  const user=db.prepare("SELECT * FROM users WHERE email=?").get(req.body.email);
  if(!user) return res.json({ok:true});

  const newPass=Math.random().toString(36).slice(-8);
  const hash=await bcrypt.hash(newPass,10);
  db.prepare("UPDATE users SET password=? WHERE id=?").run(hash,user.id);

  await transporter.sendMail({
    from:"Scan Soal AI",
    to:req.body.email,
    subject:"Reset Password",
    text:`Password baru kamu: ${newPass}`
  });

  res.json({ok:true});
});

// ===== UPLOAD & OCR =====
const upload=multer({dest:"uploads/"});

app.post("/scan",upload.single("image"),async(req,res)=>{
  const img=req.file.path;
  const ocr=(await Tesseract.recognize(img,"eng")).data.text;

  // ===== GROQ AI =====
  const groq=await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:"llama3-8b-8192",
      messages:[{
        role:"user",
        content:`Ubah teks ini menjadi soal pilihan ganda dan essay:\n${ocr}`
      }]
    })
  }).then(r=>r.json());

  const ai=groq.choices[0].message.content;

  res.json({ocr,ai});
});

// ===== EXPORT WORD =====
app.post("/export",async(req,res)=>{
  const doc=new Document({
    sections:[{children:req.body.text.split("\n").map(t=>new Paragraph(t))}]
  });
  const buf=await Packer.toBuffer(doc);
  res.setHeader("Content-Disposition","attachment; filename=soal.docx");
  res.send(buf);
});

app.listen(PORT,()=>console.log("RUNNING",PORT));
