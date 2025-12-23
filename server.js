const express = require('express');
const sheetsDB = require('./sheetsService.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

// Configuración de Carpetas
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));
const upload = multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

// --- HELPER ACTUALIZACIÓN ---
async function safeUpdate(id, changes) {
    const rows = await sheetsDB.readSheet('Despachos');
    const index = rows.findIndex(r => String(r.id) === String(id));
    if (index === -1) throw new Error('No encontrado');
    const updatedRow = { ...rows[index], ...changes };
    await sheetsDB.updateRow('Despachos', id, updatedRow);
    return updatedRow;
}

// --- RUTAS API ---

app.post('/api/login', async (req, res) => {
    const { user, pass } = req.body;
    try {
        const users = await sheetsDB.readSheet('Usuarios');
        const found = users.find(u => String(u.usuario).trim().toLowerCase() === String(user).trim().toLowerCase() && String(u.password).trim() === String(pass).trim());
        if (found) res.json({ success: true, user: { nombre: found.nombre, rol: found.rol.toLowerCase().trim() } });
        else res.status(401).json({ success: false });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/data', async (req, res) => {
    try {
        const [despachos, vehiculos, usuarios] = await Promise.all([
            sheetsDB.readSheet('Despachos'),
            sheetsDB.readSheet('Vehiculos'),
            sheetsDB.readSheet('Usuarios')
        ]);
        const conductores = usuarios.filter(u => u.rol.toLowerCase().trim() === 'conductor');
        res.json({ despachos: despachos.reverse(), vehiculos, conductores }); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/crear', async (req, res) => {
    try {
        const nuevo = {
            id: Date.now(),
            fecha_entrega: req.body.fecha,
            nombre_ruta: req.body.nombre_ruta,
            detalles_clientes_json: req.body.detalles,
            total_kg_ruta: req.body.total_kg,
            estado: 'Creada'
        };
        await sheetsDB.appendRow('Despachos', nuevo);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/editar/:id', async (req, res) => {
    try {
        const cambios = {
            fecha_entrega: req.body.fecha,
            nombre_ruta: req.body.nombre_ruta,
            detalles_clientes_json: req.body.detalles,
            total_kg_ruta: req.body.total_kg,
            observaciones: req.body.observaciones
        };
        await safeUpdate(req.params.id, cambios);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/asignar/:id', async (req, res) => {
    try {
        const cambios = {
            placa_vehiculo: req.body.placa,
            conductor_asignado: req.body.conductor,
            tipo_comision: req.body.tipo_comision,
            valor_tarifa: req.body.valor_tarifa,
            estado: req.body.estado || 'Asignada'
        };
        await safeUpdate(req.params.id, cambios);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/finalizar/:id', upload.single('foto'), async (req, res) => {
    try {
        const cambios = {
            estado: 'Finalizada',
            detalles_clientes_json: req.body.detalles_actualizados,
            gastos_adicionales: req.body.gastos_json,
            total_pagar_conductor: req.body.total_pagar
        };
        if (req.file) cambios.evidencia_foto = `/uploads/${req.file.filename}`;
        await safeUpdate(req.params.id, cambios);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/borrar/:id', async (req, res) => {
    try {
        await sheetsDB.deleteRow('Despachos', req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Servidor Logístico en puerto ${PORT}`));