// database.js
const sqlite3 = require('sqlite3').verbose();

// Conecta a una base de datos (o la crea si no existe)
const db = new sqlite3.Database('./users.db', (err) => {
    if (err) {
        console.error("Error al abrir la base de datos", err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
        
        // 1. Tabla de Usuarios
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user'
        )`);

        // 2. Tabla de Productos (Catálogo Único)
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            category TEXT,
            image TEXT
        )`, (err) => {
            // Seed: Si la tabla se acaba de crear, metemos productos de ejemplo
            if (!err) {
                db.get("SELECT count(*) as count FROM products", (err, row) => {
                    if (row.count === 0) {
                        const seed = [
                            ['Ropa de Bebé (Set)', 299.00, 'ropa', 'https://placehold.co/100x100/1e293b/3b82f6?text=Ropa'],
                            ['Pañales Premium (50pz)', 189.50, 'accesorios', 'https://placehold.co/100x100/1e293b/06b6d4?text=Pañales'],
                            ['Juguete Educativo', 349.00, 'accesorios', 'https://placehold.co/100x100/1e293b/10b981?text=Juguete'],
                            ['Carriola Ligera Pro', 2199.00, 'accesorios', 'https://placehold.co/100x100/1e293b/f472b6?text=Carriola'],
                            ['Zapatitos (0-6m)', 199.00, 'ropa', 'https://placehold.co/100x100/1e293b/6366f1?text=Calzado']
                        ];
                        const stmt = db.prepare("INSERT INTO products (name, price, category, image) VALUES (?,?,?,?)");
                        seed.forEach(p => stmt.run(p));
                        stmt.finalize();
                        console.log("Productos iniciales cargados.");
                    }
                });
            }
        });

        // 3. Tabla Maestra de Ventas
        db.run(`CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            total REAL,
            date DATETIME DEFAULT CURRENT_TIMESTAMP,
            method TEXT
        )`);

        // 4. Tabla Detalle de Ventas (Maestro/Detalle)
        db.run(`CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER,
            product_name TEXT,
            quantity INTEGER,
            price REAL,
            FOREIGN KEY(sale_id) REFERENCES sales(id)
        )`);
    }
});

module.exports = db;