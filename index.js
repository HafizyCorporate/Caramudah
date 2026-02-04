import express from "express";
import cors from "cors";
import multer from "multer";
import Tesseract from "tesseract.js";
import OpenAI from "openai";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function lines(text) {
  return (text || "").split("\n").map(s => s.trim()).filter(Boolean);
}

app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });

    const pgCount = Number(req.body.pgCount || 0);
    const essayCount = Number(req.body.essayCount || 0);

    const result = await Tesseract.recognize(req.file.path, "ind+eng");
    const text = result.data.text || "";

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Keluarkan JSON valid TANPA teks lain. Format persis: {\"soal\":\"...\",\"jawaban\":\"...\"}. " +
            "Pisahkan baris dengan newline. Soal PG dulu, lalu Essay. Jawaban PG dulu (A/B/C/D), lalu jawaban Essay."
        },
        { role: "user", content: text }
      ]
    });

    let json;
    try {
      json = JSON.parse(ai.choices[0].message.content);
    } catch {
      json = { soal: text, jawaban: "" };
    }

    const soalLines = lines(json.soal);
    const jawabanLines = lines(json.jawaban);

    const pgSoal = soalLines.slice(0, pgCount);
    const essaySoal = soalLines.slice(pgCount, pgCount + essayCount);

    const pgJawaban = jawabanLines.slice(0, pgCount);
    const essayJawaban = jawabanLines.slice(pgCount, pgCount + essayCount);

    const soalChildren = [
      new Paragraph({ text: "SOAL - PILIHAN GANDA", heading: HeadingLevel.HEADING_1 }),
    ];

    pgSoal.forEach((q, i) => {
      soalChildren.push(new Paragraph(`${i + 1}. ${q}`));
      soalChildren.push(new Paragraph("   A. "));
      soalChildren.push(new Paragraph("   B. "));
      soalChildren.push(new Paragraph("   C. "));
      soalChildren.push(new Paragraph("   D. "));
    });

    soalChildren.push(new Paragraph(""));
    soalChildren.push(new Paragraph({ text: "SOAL - ESSAY", heading: HeadingLevel.HEADING_1 }));

    essaySoal.forEach((q, i) => {
      soalChildren.push(new Paragraph(`${i + 1}. ${q}`));
      soalChildren.push(new Paragraph(""));
    });

    const jawabanChildren = [
      new Paragraph({ text: "JAWABAN - PILIHAN GANDA", heading: HeadingLevel.HEADING_1 }),
    ];

    pgJawaban.forEach((a, i) => {
      jawabanChildren.push(new Paragraph(`${i + 1}. ${a}`));
    });

    jawabanChildren.push(new Paragraph(""));
    jawabanChildren.push(new Paragraph({ text: "JAWABAN - ESSAY", heading: HeadingLevel.HEADING_1 }));

    essayJawaban.forEach((a, i) => {
      jawabanChildren.push(new Paragraph(`${i + 1}. ${a}`));
    });

    const doc = new Document({
      sections: [
        { children: soalChildren },     // Halaman 1: Soal
        { children: jawabanChildren },  // Halaman 2: Jawaban
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync("hasil.docx", buffer);

    res.json({
      soal: json.soal || "",
      jawaban: json.jawaban || "",
      download: "/download"
    });

  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: "Gagal memproses gambar" });
  }
});

app.get("/download", (req, res) => {
  res.download("hasil.docx");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port " + PORT));
