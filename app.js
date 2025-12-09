// app.js - VERSIÓN FINAL DEPURADA (Con logs para cazar el error)
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require('./database.js');
const path = require('path');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const os = require('os');
const nodemailer = require('nodemailer');

const app = express();
// En Render el puerto nos lo da el sistema
const port = process.env.PORT || 3000;
const saltRounds = 10;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'tu_secreto_muy_secreto_y_largo_y_diferente',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
    rolling: true
}));

// --- CONFIGURACIÓN DE CORREO (ETHEREAL) ---
let transporter;
async function createTestAccount() {
    try {
        let testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: "smtp.ethereal.email",
            port: 587,
            secure: false, 
            auth: { user: testAccount.user, pass: testAccount.pass },
        });
        console.log("📧 Sistema de correos listo. Cuenta:", testAccount.user);
    } catch (e) {
        console.log("Error configurando correo: " + e);
    }
}
createTestAccount();

async function sendEmail(to, subject, htmlContent) {
    if (!transporter) return;
    try {
        let info = await transporter.sendMail({
            from: '"GettMex POS" <system@gettmex.com>',
            to: to,
            subject: subject,
            html: htmlContent,
        });
        console.log("📨 Correo enviado a:", to);
        console.log("🔗 LINK PARA VER EL CORREO: %s", nodemailer.getTestMessageUrl(info));
    } catch (error) {
        console.error("Error enviando correo:", error);
    }
}

// --- MIDDLEWARES ---
const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.status(401).send('<h1>Acceso denegado.</h1>');
    next();
};
const requireAdmin = (req, res, next) => {
    if (req.session.role !== 'admin') return res.status(403).json({ message: 'Requiere Admin.' });
    next();
};

// --- APIS ---
app.get('/api/server-status', requireLogin, (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    res.json({
        uptime: process.uptime(),
        memUsage: Math.round(((totalMem - freeMem) / totalMem) * 100),
        platform: os.platform(),
        nodeVersion: process.version
    });
});

app.get('/api/products', requireLogin, (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/sales', requireLogin, (req, res) => {
    const { items, total, method } = req.body;
    const userId = req.session.userId;
    if (!items || items.length === 0) return res.status(400).json({message: "Carrito vacío"});

    db.run("INSERT INTO sales (user_id, total, method) VALUES (?, ?, ?)", [userId, total, method], function(err) {
        if (err) return res.status(500).json({error: err.message});
        const saleId = this.lastID;
        const stmt = db.prepare("INSERT INTO sale_items (sale_id, product_name, quantity, price) VALUES (?, ?, ?, ?)");
        items.forEach(item => stmt.run(saleId, item.name, item.qty, item.price));
        stmt.finalize();
        res.json({ message: "Venta registrada", saleId: saleId });
    });
});

app.get('/api/sales', requireLogin, (req, res) => {
    db.all("SELECT * FROM sales ORDER BY date DESC LIMIT 50", [], (err, rows) => res.json(rows));
});

app.get('/api/me', requireLogin, (req, res) => {
    res.json({ username: req.session.username, role: req.session.role });
});

app.get('/api/users', requireLogin, requireAdmin, (req, res) => {
    db.all("SELECT id, username, role FROM users", [], (err, rows) => res.json(rows));
});
app.put('/api/users/role', requireLogin, requireAdmin, (req, res) => {
    const { userId, newRole } = req.body;
    if (userId === req.session.userId) return res.status(400).json({ message: "No puedes cambiar tu propio rol." });
    db.run("UPDATE users SET role = ? WHERE id = ?", [newRole, userId], (err) => res.json({ message: "Rol actualizado." }));
});
app.delete('/api/users/:id', requireLogin, requireAdmin, (req, res) => {
    const userId = req.params.id;
    if (parseInt(userId) === req.session.userId) return res.status(400).json({ message: "No puedes eliminarte." });
    db.run("DELETE FROM users WHERE id = ?", [userId], (err) => res.json({ message: "Usuario eliminado." }));
});

// --- RUTAS DE AUTENTICACIÓN ---

app.post('/register', async (req, res) => {
    const { username, password, 'g-recaptcha-response': captchaResponse } = req.body;
    
    // ⚠️ ¡PON AQUÍ TU CLAVE SECRETA NUEVA (LA DE RENDER)!
    const secretKey = '6LfBqiUsAAAAAJMFN976FIerb814sPogOULwvg6-'; 

    try {
        // URL sin remoteip para evitar problemas en la nube
        const verificationURL = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaResponse}`;
        
        const captchaVerification = await axios.post(verificationURL);
        
        if (!captchaVerification.data.success) {
            console.log("Error Captcha Registro:", captchaVerification.data);
            return res.status(400).json({ message: 'Captcha inválido.' });
        }

        db.get("SELECT COUNT(*) as count FROM users", async (err, row) => {
            const isFirstUser = (row.count === 0);
            const userRole = isFirstUser ? 'admin' : 'user';
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            
            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, hashedPassword, userRole], async function(err) {
                if (err) return res.status(400).json({ message: 'El usuario ya existe.' });
                
                // --- ENVIAR CORREO ---
                const emailHtml = `
                    <h2>Bienvenido a GettMex POS</h2>
                    <p>Hola <b>${username}</b>, gracias por registrarte.</p>
                    <p>Tu rol asignado es: <strong>${userRole}</strong></p>
                    <p><a href="https://localhost:3000">Click aquí para activar tu cuenta</a></p>
                `;
                await sendEmail(username, "Activa tu cuenta - GettMex", emailHtml);
                
                res.status(201).json({ message: `Registrado. Revisa la consola para el correo.` });
            });
        });
    } catch (error) { res.status(500).json({ message: 'Error servidor.' }); }
});

app.post('/api/recover-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Falta el correo." });

    db.get("SELECT * FROM users WHERE username = ?", [email], async (err, user) => {
        if (!user) return res.status(404).json({ message: "Correo no encontrado." });

        const emailHtml = `
            <h2>Recuperación de Contraseña</h2>
            <p>Has solicitado cambiar tu contraseña.</p>
            <p><a href="https://proyectofinaldweb.onrender.com/reset-password.html">CLICK AQUÍ PARA RESTABLECER</a></p>
        `;
        
        await sendEmail(email, "Restablecer Password - GettMex", emailHtml);
        res.json({ message: "Correo enviado. Revisa la consola del servidor." });
    });
});

app.post('/api/update-password', async (req, res) => {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ message: "Faltan datos." });
    try {
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        db.run("UPDATE users SET password = ? WHERE username = ?", [hashedPassword, email], function(err) {
            if (err) return res.status(500).json({ message: "Error al actualizar." });
            if (this.changes === 0) return res.status(404).json({ message: "Usuario no encontrado." });
            res.json({ message: "Contraseña actualizada correctamente." });
        });
    } catch (error) { res.status(500).json({ message: "Error del servidor." }); }
});

// --- LOGIN CON DEPURACIÓN ---
app.post('/login', (req, res) => {
    const { username, password, 'g-recaptcha-response': captchaResponse } = req.body;
    
    // ⚠️ ¡PON AQUÍ TU CLAVE SECRETA NUEVA (LA DE RENDER)!
    const secretKey = '6LfBqiUsAAAAAJMFN976FIerb814sPogOULwvg6-'; 

    console.log("--> Intentando verificar Captcha..."); 

    // URL sin remoteip para evitar bloqueos
    const verificationURL = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaResponse}`;

    axios.post(verificationURL)
        .then(response => {
            // 👇 CHISMOSO ACTIVADO: ESTO SALDRÁ EN LOS LOGS 👇
            console.log("🔥 RESPUESTA DE GOOGLE:", response.data); 

            if (!response.data.success) {
                return res.status(400).json({ message: 'Captcha inválido. Revisa logs.' });
            }

            db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
                if (!user) return res.status(401).json({ message: 'Credenciales inválidas.' });
                const match = await bcrypt.compare(password, user.password);
                if (match) {
                    req.session.userId = user.id;
                    req.session.username = user.username;
                    req.session.role = user.role;
                    req.session.save(() => res.status(200).json({ message: 'Login exitoso.' }));
                } else {
                    res.status(401).json({ message: 'Credenciales inválidas.' });
                }
            });
        })
        .catch((e) => {
            console.error("Error conexión Google:", e);
            res.status(500).json({ message: 'Error captcha.' });
        });
});

app.get('/logout', (req, res) => { req.session ? req.session.destroy(() => res.redirect('/')) : res.redirect('/'); });
app.get('/dashboard', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// EN LA NUBE USAMOS HTTP NORMAL (Render pone el HTTPS)
app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});