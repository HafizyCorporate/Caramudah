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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const result = await Tesseract.recognize(req.file.path, "ind");
    const text = result.data.text;

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Pisahkan soal dan jawaban dari teks berikut. Balas JSON: {soal:'...', jawaban:'...'}"
        },
        { role: "user", content: text }
      ]
    });

    const json = JSON.parse(ai.choices[0].message.content);

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "SOAL", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(json.soal),
            new Paragraph(""),
            new Paragraph({ text: "JAWABAN", heading: HeadingLevel.HEADING_1 }),
            new Paragraph(json.jawaban),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync("hasil.docx", buffer);

    res.json({
      soal: json.soal,
      jawaban: json.jawaban,
      download: "/download"
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal memproses gambar" });
  }
});

app.get("/download", (req, res) => {
  res.download("hasil.docx");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port " + PORT));
