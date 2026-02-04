import express from "express";
import cors from "cors";
import multer from "multer";
import Tesseract from "tesseract.js";
import { Groq } from "groq-sdk";
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from "docx";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

/* ===== middleware ===== */
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ===== folder aman ===== */
const uploadsDir = path.resolve("uploads");
const processedDir = path.resolve("processed");

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });

/* ===== MULTER FIX (ANTI EEXIST) ===== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir); // ❗ TIDAK bikin folder
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/* ===== groq ===== */
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/* ===== util ===== */
function cleanOCR(text) {
  return text
    .replace(/\n{2,}/g, "\n")
    .replace(/[|]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ===== routes ===== */
app.post("/upload", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: "Tidak ada gambar" });
    }

    let fullText = "";

    for (const file of req.files) {
      const result = await Tesseract.recognize(file.path, "ind+eng");
      fullText += "\n" + (result.data.text || "");
      fs.unlinkSync(file.path);
    }

    const cleanedText = cleanOCR(fullText);

    const ai = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content:
            'Rapikan OCR jadi soal & jawaban. Output JSON: {"soal":"...","jawaban":"..."}',
        },
        { role: "user", content: cleanedText },
      ],
      temperature: 0.2,
      max_tokens: 700,
    });

    let data;
    try {
      data = JSON.parse(ai.choices[0].message.content);
    } catch {
      data = {
        soal: cleanedText,
        jawaban: "Jawaban tidak dapat ditentukan.",
      };
    }

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "SOAL", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(data.soal),
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({ text: "JAWABAN", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(data.jawaban),
          ],
        },
      ],
    });

    const out = path.join(processedDir, "hasil.docx");
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(out, buffer);

    res.json({
      soal: data.soal,
      jawaban: data.jawaban,
      download: "/download",
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: "Gagal proses" });
  }
});

app.get("/download", (req, res) => {
  const file = path.resolve("processed/hasil.docx");
  if (!fs.existsSync(file)) return res.status(404).send("File belum ada");
  res.download(file, "hasil-soal-jawaban.docx");
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
