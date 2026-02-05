import express from "express";
import cors from "cors";
import multer from "multer";
import Tesseract from "tesseract.js";
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from "docx";
import fs from "fs";
import path from "path";

// ===== Folder check =====
if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
if (!fs.existsSync("./processed")) fs.mkdirSync("./processed");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ===== Multer setup =====
const upload = multer({ dest: "uploads/" });

// ===== Mock GroqAI =====
// Ini menggantikan import @groqai/sdk yang belum ada
const groqai = {
  chat: {
    completions: {
      create: async ({ model, messages, temperature, max_tokens }) => {
        const rawText = messages[1].content || "";
        // Mock: buat soal pilihan ganda dan essay dari text
        const soalMock = rawText.split("\n").slice(0, 3).join("\n") + " ...";
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  soal: soalMock,
                  jawaban: "Jawaban otomatis (mock GroqAI)"
                })
              }
            }
          ]
        };
      }
    }
  }
};

// ===== Fungsi bersihkan hasil OCR =====
function cleanOCR(text) {
  return text
    .replace(/\n{2,}/g, "\n")
    .replace(/[|]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ===== Endpoint upload & proses OCR + AI =====
app.post("/upload", upload.array("images", 5), async (req, res) => {
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

    const aiRes = await groqai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `
Kamu asisten guru.
Rapikan teks OCR menjadi soal singkat, rangkum cerita, format pilihan ganda dan essay.
Buat jawaban yang benar dan ringkas.
Keluarkan JSON VALID: {"soal":"...","jawaban":"..."}
        ` },
        { role: "user", content: cleanedText }
      ],
      temperature: 0.2,
      max_tokens: 800
    });

    let json;
    try {
      json = JSON.parse(aiRes.choices[0].message.content);
    } catch {
      json = {
        soal: cleanedText,
        jawaban: "Jawaban tidak dapat ditentukan. Mohon cek kembali soal."
      };
    }

    // ===== Generate Word =====
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
    fs.writeFileSync("processed/hasil.docx", buffer);

    res.json({
      soal: json.soal || "",
      jawaban: json.jawaban || "",
      download: "/download"
    });
  } catch (e) {
    console.error("UPLOAD FATAL ERROR:", e);
    res.status(500).json({ error: "Gagal memproses gambar / AI error" });
  }
});

// ===== Download Word =====
app.get("/download", (req, res) => {
  const filePath = path.resolve("processed/hasil.docx");
  if (!fs.existsSync(filePath)) return res.status(404).send("File belum tersedia");
  res.download(filePath, "hasil-soal-jawaban.docx");
});

// ===== Start server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
