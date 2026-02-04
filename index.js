const express = require("express");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ====== CONFIG ======
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.1-70b-versatile";

// ====== MIDDLEWARE ======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ====== MULTER ======
const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ====== ROUTES ======
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ====== PROCESS ======
app.post("/process", upload.array("images", 5), async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: "GROQ_API_KEY belum di set" });
    }

    // NOTE:
    // Groq BELUM support vision (image)
    // Jadi kita anggap hasil OCR sudah ada / manual input
    // (bisa ditambah OCR nanti)

    const prompt = `
Ini adalah soal ujian.
Tolong jawab dengan rapi dan jelas.

Soal:
${"Soal hasil OCR akan masuk di sini"}
`;

    const groqRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: "Kamu adalah asisten guru yang menjawab soal dengan jelas." },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      }
    );

    const data = await groqRes.json();

    const jawaban = data.choices?.[0]?.message?.content || "Gagal generate jawaban";

    res.json({
      soal: "Soal berhasil diproses.",
      jawaban
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
