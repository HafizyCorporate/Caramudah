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

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

app.post("/upload", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Tidak ada file yang diupload" });
    }

    // OCR gabungan dari max 5 gambar
    let fullText = "";
    for (const file of req.files) {
      const result = await Tesseract.recognize(file.path, "ind+eng");
      fullText += "\n" + (result.data.text || "");
      fs.unlinkSync(file.path); // hapus file sementara
    }

    const ai = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant", // ✅ MODEL BARU (AKTIF)
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            'Pisahkan teks menjadi SOAL dan JAWABAN. Kembalikan JSON valid tanpa teks lain: {"soal":"...","jawaban":"..."}',
        },
        { role: "user", content: fullText },
      ],
    });

    let json;
    try {
      json = JSON.parse(ai.choices[0].message.content);
    } catch {
      json = { soal: fullText, jawaban: "" };
    }

    // Word: Halaman 1 = Soal, Halaman 2 = Jawaban
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
      soal: json.soal || "",
      jawaban: json.jawaban || "",
      download: "/download",
    });
  } catch (e) {
    console.error("UPLOAD FATAL ERROR:", e);
    res.status(500).json({ error: "Gagal memproses gambar / AI error" });
  }
});

app.get("/download", (req, res) => {
  const filePath = path.resolve("hasil.docx");
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File belum tersedia");
  }
  res.download(filePath, "hasil-soal-jawaban.docx");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port " + PORT));
