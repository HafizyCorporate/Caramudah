import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import session from "express-session";
import SQLiteStore from "connect-sqlite3";
import bodyParser from "body-parser";

const app = express();
const port = 3000;

// Buat folder uploads & processed kalau belum ada
["uploads", "processed"].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Setup session SQLite
app.use(session({
  store: new (SQLiteStore(session))({ db: "database.db", dir: "./" }),
  secret: "secretkey123",
  resave: false,
  saveUninitialized: true
}));

// Middleware
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Multer upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Mock database users
let users = [{ email: "admin@example.com", password: "1234" }];

// Mock AI function
async function processImage(filePath, numMCQ = 5, numEssay = 2) {
  return {
    soal: `Contoh soal MCQ ${numMCQ} & Essay ${numEssay} dari file ${filePath}`,
    jawaban: `Contoh jawaban dari file ${filePath}`
  };
}

// Routes
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (user) {
    req.session.user = email;
    res.json({ success: true });
  } else res.json({ success: false, message: "Email atau password salah" });
});

app.post("/register", (req, res) => {
  const { email, password } = req.body;
  if (users.find(u => u.email === email)) return res.json({ success: false, message: "Email sudah terdaftar" });
  users.push({ email, password });
  res.json({ success: true });
});

app.post("/forgot", (req, res) => {
  const { email } = req.body;
  const user = users.find(u => u.email === email);
  if (user) res.json({ success: true, password: user.password });
  else res.json({ success: false, message: "Email tidak ditemukan" });
});

app.post("/upload", upload.single("file"), async (req, res) => {
  const { numMCQ, numEssay } = req.body;
  const result = await processImage(req.file.path, numMCQ, numEssay);
  res.json(result);
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
