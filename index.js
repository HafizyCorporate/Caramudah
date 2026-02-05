import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import session from 'express-session';
import SQLiteStore from 'connect-sqlite3';
import cors from 'cors';
import bodyParser from 'body-parser';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Session
app.use(session({
    store: new (SQLiteStore(session))({ db: 'sessions.db', dir: './' }),
    secret: 'secret-key',
    resave: false,
    saveUninitialized: true
}));

// Buat folder kalau belum ada
['uploads','processed'].forEach(folder => {
    if(!fs.existsSync(folder)) fs.mkdirSync(folder);
});

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Mock Database
let users = [
    {email:'test@test.com', password:'123456'}
];

// Routes
app.post('/register', (req,res)=>{
    const {email,password} = req.body;
    if(users.find(u=>u.email===email)) return res.json({success:false, msg:'Email sudah terdaftar'});
    users.push({email,password});
    res.json({success:true});
});

app.post('/login', (req,res)=>{
    const {email,password} = req.body;
    const user = users.find(u=>u.email===email && u.password===password);
    if(user){
        req.session.user = user;
        return res.json({success:true});
    }
    res.json({success:false, msg:'Email/Password salah'});
});

app.post('/forgot', (req,res)=>{
    const {email} = req.body;
    if(users.find(u=>u.email===email)) return res.json({success:true, msg:'Email reset password terkirim (mock)'});
    res.json({success:false, msg:'Email tidak ditemukan'});
});

// Proses Gambar & Buat Soal (Mock AI)
app.post('/process', upload.single('image'), (req,res)=>{
    // Mock AI generate soal
    const soal = {
        pilihanGanda: ["Soal PG 1","Soal PG 2"],
        essay: ["Soal Essay 1"]
    };
    res.json({success:true, soal});
});

// Jalankan Server
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
