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

// ===== Database setup =====
const db = new sqlite3.Database("./database.db");
db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password TEXT)");

// ===== Folder check =====
fs.mkdirSync("./uploads", { recursive: true });
fs.mkdirSync("./processed", { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use(session({
  secret: "supersecret",
  resave: false,
  saveUninitialized: true
}));

const upload = multer({ dest: "uploads/" });

// ===== Mock GroqAI =====
const groqai = {
  chat: {
    completions: {
      create: async ({ model, messages }) => {
        const rawText = messages[1].content || "";
        const soalMock = rawText.split("\n").slice(0, 3).join("\n") + " ...";
        return {
          choices: [
            { message: { content: JSON.stringify({ soal: soalMock, jawaban: "Jawaban otomatis (mock GroqAI)" }) } }
          ]
        };
      }
    }
  }
};

// ===== Helper =====
function cleanOCR(text) {
  return text.replace(/\n{2,}/g, "\n").replace(/[|]/g, "").replace(/\s{2,}/g, " ").trim();
}

// ===== Upload & Process =====
app.post("/upload", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: "Tidak ada file diupload" });

    let fullText = "";
    for (const file of req.files) {
      const result = await Tesseract.recognize(file.path, "ind+eng");
      fullText += "\n" + (result.data.text || "");
      fs.unlinkSync(file.path);
    }

    const cleanedText = cleanOCR(fullText);

    const aiRes = await groqai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Rapikan OCR menjadi soal singkat, buat jawaban, keluarkan JSON: {soal,jawaban}" },
        { role: "user", content: cleanedText }
      ]
    });

    let json;
    try { json = JSON.parse(aiRes.choices[0].message.content); }
    catch { json = { soal: cleanedText, jawaban: "Jawaban tidak tersedia" }; }

    const doc = new Document({
      sections: [{ children: [
        new Paragraph({ text: "SOAL", heading: HeadingLevel.HEADING_1 }),
        new Paragraph(json.soal || ""),
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ text: "JAWABAN", heading: HeadingLevel.HEADING_1 }),
        new Paragraph(json.jawaban || "")
      ]}]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync("processed/hasil.docx", buffer);

    res.json({ soal: json.soal, jawaban: json.jawaban, download: "/download" });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: "Gagal proses gambar/AI error" });
  }
});

// ===== Download Word =====
app.get("/download", (req, res) => {
  const filePath = path.resolve("processed/hasil.docx");
  if (!fs.existsSync(filePath)) return res.status(404).send("File belum tersedia");
  res.download(filePath, "hasil-soal-jawaban.docx");
});

// ===== Register/Login =====
app.post("/register", async (req,res)=>{
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password,10);
  db.run("INSERT INTO users(email,password) VALUES(?,?)",[email,hash], function(err){
    if(err) return res.status(400).json({error:"Email sudah terdaftar"});
    res.json({success:true});
  });
});

app.post("/login", (req,res)=>{
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email=?",[email], async (err,row)=>{
    if(!row) return res.status(400).json({error:"Email tidak ditemukan"});
    const match = await bcrypt.compare(password,row.password);
    if(!match) return res.status(400).json({error:"Password salah"});
    req.session.userId = row.id;
    res.json({success:true});
  });
});

// ===== Start server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Server running on port "+PORT));
