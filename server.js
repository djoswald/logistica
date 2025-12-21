const express = require('express');
const sheetsDB = require('./sheetsService.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

app.post('/api/login', async (req, res) => {
    const { user, pass } = req.body;
    try {
        const usuarios = await sheetsDB.readSheet('Usuarios');
        const validUser = usuarios.find(u => {
            return String(u.usuario).trim().toLowerCase() === String(user).trim().toLowerCase() && 
                   String(u.password).trim() === String(pass).trim();
        });
        if (validUser) {
            res.json({ success: true, user: { nombre: validUser.nombre, rol: String(validUser.rol).trim().toLowerCase() } });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/conductores', async (req, res) => {
    try {
        const usuarios = await sheetsDB.readSheet('Usuarios');
        const conductores = usuarios
            .filter(u => String(u.rol).trim().toLowerCase() === 'conductor')
            .map(u => ({ nombre: u.nombre }));
        res.json(conductores);
    } catch (e) { res.status(500).json([]); }
});

app.get('/api/despachos', async (req, res) => {
    try {
        const data = await sheetsDB.readSheet('Despachos');
        res.json({ data: Array.isArray(data) ? data.reverse() : [] });
    } catch (e) { res.json({ data: [] }); }
});

app.post('/api/despachos', upload.single('foto'), async (req, res) => {
    try {
        const datos = procesarDespacho(req.body, req.file);
        await sheetsDB.appendRow('Despachos', datos);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/despachos/:id', upload.single('foto'), async (req, res) => {
    try {
        const datos = procesarDespacho(req.body, req.file, req.params.id);
        await sheetsDB.updateRow('Despachos', req.params.id, datos);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/despachos/:id', async (req, res) => {
    try {
        await sheetsDB.deleteRow('Despachos', req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

function procesarDespacho(body, file, idExistente = null) {
    const num = (v) => parseFloat(v) || 0;
    return {
        id: idExistente || Date.now(),
        fecha: body.fecha,
        cliente: body.cliente,
        conductor: body.conductor,
        lista_productos: body.lista_productos_texto,
        total_kg_salida: num(body.total_kg_salida),
        total_kg_entregado: num(body.total_kg_entregado),
        kg_devolucion: num(body.total_kg_salida) - num(body.total_kg_entregado),
        tarifa_comision: num(body.tarifa_comision),
        total_comision: Math.round(num(body.total_kg_entregado) * num(body.tarifa_comision)),
        estado: body.estado,
        observacion: body.observaciones || '',
        foto: file ? `/uploads/${file.filename}` : (body.foto_actual || '')
    };
}

app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));