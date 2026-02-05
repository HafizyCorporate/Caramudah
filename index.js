import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { GroqAI } from "@groqai/sdk";
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from "docx";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ===== Folder Setup =====
const UPLOAD_DIR = "./uploads";
const PROCESSED_DIR = "./processed";
if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if(!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR);

// ===== Multer =====
const upload = multer({ dest: UPLOAD_DIR });

// ===== GroqAI =====
const groqai = new GroqAI({
  apiKey: process.env.GROQ_API_KEY,
});

// ===== Helper =====
function cleanOCR(text){
  return text.replace(/\n{2,}/g,"\n").replace(/[|]/g,"").replace(/\s{2,}/g," ").trim();
}

// ===== USERS DB (simple JSON for demo) =====
const USERS_DB = "./users.json";
if(!fs.existsSync(USERS_DB)) fs.writeFileSync(USERS_DB, JSON.stringify([]));

// ===== Routes =====

// REGISTER
app.post("/register", (req,res)=>{
  const {email,password} = req.body;
  const users = JSON.parse(fs.readFileSync(USERS_DB));
  if(users.find(u=>u.email===email)) return res.json({success:false,error:"Email sudah terdaftar"});
  users.push({email,password});
  fs.writeFileSync(USERS_DB,JSON.stringify(users));
  res.json({success:true});
});

// LOGIN
app.post("/login",(req,res)=>{
  const {email,password} = req.body;
  const users = JSON.parse(fs.readFileSync(USERS_DB));
  const user = users.find(u=>u.email===email && u.password===password);
  if(user) res.json({success:true});
  else res.json({success:false,error:"Email atau password salah"});
});

// UPLOAD
app.post("/upload", upload.array("images",5), (req,res)=>{
  if(!req.files || req.files.length===0) return res.json({success:false,error:"Tidak ada file"});
  const files = req.files.map(f=>({filename:f.filename, originalname:f.originalname}));
  res.json({success:true,files});
});

// PROCESS AI
app.post("/process-ai", async (req,res)=>{
  try{
    const {files} = req.body;
    if(!files || files.length===0) return res.json({success:false,error:"Tidak ada file untuk diproses"});

    let fullText = "";
    for(const f of files){
      const filePath = path.join(UPLOAD_DIR,f);
      if(fs.existsSync(filePath)){
        fullText += "\n" + fs.readFileSync(filePath,"utf-8"); // demo: pakai text, sesuaikan dengan OCR
      }
    }

    const cleanedText = cleanOCR(fullText);

    let json = { soal: cleanedText, jawaban: "Jawaban belum tersedia" };

    try{
      const aiRes = await groqai.chat.completions.create({
        model:"gpt-4o-mini",
        messages:[
          { role:"system", content:`Kamu adalah asisten guru. Rapikan teks hasil OCR menjadi soal & jawaban, keluarkan JSON valid {"soal":"...","jawaban":"..."}.` },
          { role:"user", content: cleanedText }
        ],
        temperature:0.2,
        max_tokens:800
      });
      json = JSON.parse(aiRes.choices[0].message.content);
      json.success = true;
    }catch(e){
      console.error("AI ERROR:",e);
      json.success = true; // tetap true supaya preview muncul
      json.error = "AI gagal memproses. Teks asli ditampilkan.";
    }

    res.json(json);

  }catch(e){
    console.error("PROCESS ERROR:",e);
    res.json({success:false,error:e.message});
  }
});

// DOWNLOAD WORD
app.get("/download",(req,res)=>{
  const doc = new Document({
    sections:[
      { children:[
        new Paragraph({text:"SOAL",heading:HeadingLevel.HEADING_1}),
        new Paragraph(fs.existsSync("hasil.docx")? fs.readFileSync("hasil.docx"):""),
      ]}
    ]
  });
  Packer.toBuffer(doc).then(buffer=>{
    fs.writeFileSync("hasil.docx",buffer);
    res.download("hasil.docx","hasil-soal.docx");
  });
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Server running on port "+PORT));
