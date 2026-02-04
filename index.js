import express from "express";
import cors from "cors";
import multer from "multer";
import Tesseract from "tesseract.js";
import Groq from "groq-sdk";
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from "docx";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

/* ===== GROQ INIT ===== */
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/* ===== UTIL ===== */
function cleanOCR(text) {
  return text
    .replace(/\n{2,}/g, "\n")
    .replace(/[|]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ===== UPLOAD API ===== */
app.post("/upload", upload.array("images", 3), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Tidak ada file yang diupload" });
    }

    let fullText = "";

    for (const file of req.files) {
      const result = await Tesseract.recognize(file.path, "ind+eng");
      fullText += "\n" + (result.data.text || "");
      fs.unlinkSync(file.path);
    }

    const cleanedText = cleanOCR(fullText);

    const aiRes = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content: `
Kamu adalah asisten guru.
Tugas:
1. Rapikan teks hasil OCR menjadi soal yang singkat dan jelas.
2. Buang teks tidak penting (ikon, menu, watermark, dll).
3. Jika soal cerita, rangkum 1–2 kalimat inti.
4. Jika pilihan ganda, format:
   1. Pertanyaan?
      A. ...
      B. ...
      C. ...
      D. ...
5. Jika essay, tulis pertanyaannya saja.
6. Buatkan JAWABAN yang benar dan ringkas.
7. Output HARUS JSON VALID:
{"soal":"...","jawaban":"..."}
          `,
        },
        { role: "user", content: cleanedText },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });

    let json;
    try {
      json = JSON.parse(aiRes.choices[0].message.content);
    } catch {
      json = {
        soal: cleanedText,
        jawaban: "Jawaban tidak dapat ditentukan. Silakan cek kembali soal.",
      };
    }

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "SOAL", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(json.soal || ""),
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({ text: "JAWABAN", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(json.jawaban || ""),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync("hasil.docx", buffer);

    res.json({
      soal: json.soal,
      jawaban: json.jawaban,
      download: "/download",
    });
  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ error: "Gagal memproses OCR / AI" });
  }
});

/* ===== DOWNLOAD ===== */
app.get("/download", (req, res) => {
  const filePath = path.resolve("hasil.docx");
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File belum tersedia");
  }
  res.download(filePath, "hasil-soal-jawaban.docx");
});

/* ===== SERVER ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
