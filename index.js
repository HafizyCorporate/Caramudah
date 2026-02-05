import express from "express";
import session from "express-session";
import SQLiteStore from "connect-sqlite3";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import multer from "multer";
import sqlite3 from "sqlite3";
import nodemailer from "nodemailer";

const app = express();
const __dirname = path.resolve();

// ===================== FOLDER UPLOAD =====================
["uploads", "processed"].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

const upload = multer({ dest: "uploads/" });

// ===================== DATABASE =====================
const db = new sqlite3.Database("database.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT
  )`);
});

// ===================== MIDDLEWARE =====================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    store: new (SQLiteStore(session))({ db: "sessions.db", dir: "./" }),
    secret: "secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  })
);

// ===================== ROUTES =====================

// HOME / DASHBOARD
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login.html");
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// REGISTER
app.post("/register", (req, res) => {
  const { email, password } = req.body;
  db.run(
    "INSERT INTO users(email,password) VALUES(?,?)",
    [email, password],
    function (err) {
      if (err) return res.status(400).send("Email sudah terdaftar");
      res.send("Berhasil daftar, silahkan login");
    }
  );
});

// LOGIN
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get(
    "SELECT * FROM users WHERE email=? AND password=?",
    [email, password],
    (err, row) => {
      if (err) return res.status(500).send("Error server");
      if (!row) return res.status(400).send("Email atau password salah");
      req.session.user = { id: row.id, email: row.email };
      res.send("Login berhasil");
    }
  );
});

// LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

// FORGOT PASSWORD
app.post("/forgot", (req, res) => {
  const { email } = req.body;
  db.get("SELECT * FROM users WHERE email=?", [email], (err, row) => {
    if (!row) return res.status(400).send("Email tidak terdaftar");

    // Kirim email reset (dummy contoh)
    const transporter = nodemailer.createTransport({
      // Contoh pakai Gmail
      service: "gmail",
      auth: {
        user: "your.email@gmail.com",
        pass: "your-email-app-password",
      },
    });

    const mailOptions = {
      from: "your.email@gmail.com",
      to: email,
      subject: "Reset Password",
      text: `Klik link ini untuk reset password: http://localhost:3000/reset.html`,
    };

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) return res.status(500).send("Gagal kirim email");
      res.send("Cek email untuk reset password");
    });
  });
});

// RESET PASSWORD
app.post("/reset", (req, res) => {
  const { email, newPassword } = req.body;
  db.run(
    "UPDATE users SET password=? WHERE email=?",
    [newPassword, email],
    function (err) {
      if (err) return res.status(500).send("Gagal reset password");
      res.send("Password berhasil diubah");
    }
  );
});

// ===================== START SERVER =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
