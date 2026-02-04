import express from "express";
import cors from "cors";
import multer from "multer";
import Tesseract from "tesseract.js";
import OpenAI from "openai";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });
const WORD_PATH = path.resolve("hasil.docx");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/upload", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Tidak ada file yang diupload" });
    }

    const pg = req.body.pg || "0";
    const essay = req.body.essay || "0";

    let fullText = "";
    for (const file of req.files) {
      console.log("OCR file:", file.path);
      const result = await Tesseract.recognize(file.path, "ind+eng");
      fullText += "\n" + (result.data.text || "");
    }

    if (!fullText.trim()) {
      return res.status(400).json({ error: "OCR tidak menghasilkan teks" });
    }

    console.log("OCR DONE, kirim ke OpenAI...");

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Pisahkan soal dan jawaban dari teks OCR.
Balas JSON valid saja:
{"soal":"...","jawaban":"..."}

Jumlah PG: ${pg}
Jumlah Essay: ${essay}

Format soal:
1. Soal PG
   A. ...
   B. ...
   C. ...
   D. ...

Lanjut soal essay.
Jawaban dipisah halaman.`
        },
        { role: "user", content: fullText }
      ]
    });

    let json;
    try {
      json = JSON.parse(ai.choices[0].message.content);
    } catch (err) {
      console.error("JSON PARSE ERROR:", ai.choices[0].message.content);
      json = { soal: fullText, jawaban: "" };
    }

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "SOAL", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(json.soal || ""),
          ],
        },
        {
          children: [
            new Paragraph({ text: "JAWABAN", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(json.jawaban || ""),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(WORD_PATH, buffer);

    return res.json({
      ok: true,
      soal: json.soal || "",
      jawaban: json.jawaban || "",
      download: "/download"
    });

  } catch (e) {
    console.error("UPLOAD FATAL ERROR:", e);
    return res.status(500).json({
      error: "Server error saat memproses. Coba foto lebih kecil / 1 file dulu."
    });
  }
});

app.get("/download", (req, res) => {
  if (!fs.existsSync(WORD_PATH)) {
    return res.status(404).send("File Word belum tersedia. Klik Proses dulu.");
  }
  res.download(WORD_PATH, "hasil-soal-jawaban.docx");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port " + PORT));
