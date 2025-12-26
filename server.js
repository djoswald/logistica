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
async function safeUpdate(sheet, id, changes) {
    const rows = await sheetsDB.readSheet(sheet);
    // MEJORA: Usamos trim() para ignorar espacios accidentales al comparar IDs
    const index = rows.findIndex(r => String(r.id).trim() === String(id).trim());
    if (index === -1) throw new Error('No encontrado');
    const updatedRow = { ...rows[index], ...changes };
    await sheetsDB.updateRow(sheet, id, updatedRow);
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
        const [despachos, pedidos, vehiculos, usuarios] = await Promise.all([
            sheetsDB.readSheet('Despachos'),
            sheetsDB.readSheet('Pedidos'),
            sheetsDB.readSheet('Vehiculos'),
            sheetsDB.readSheet('Usuarios')
        ]);
        const conductores = usuarios.filter(u => u.rol.toLowerCase().trim() === 'conductor');
        const pedidosPendientes = pedidos.filter(p => p.estado === 'Pendiente');
        res.json({ despachos: despachos.reverse(), pedidos: pedidosPendientes, vehiculos, conductores }); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/historial', async (req, res) => {
    try {
        const historial = await sheetsDB.readSheet('Historial_Rutas');
        res.json(historial.reverse());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- OPERADOR: PEDIDOS ---
app.post('/api/pedidos', async (req, res) => {
    try {
        const nuevo = {
            id: Date.now(),
            fecha: req.body.fecha,
            hora: req.body.hora,
            cliente: req.body.cliente,
            orden: req.body.orden,
            productos_json: req.body.productos,
            observaciones: req.body.observaciones,
            estado: 'Pendiente'
        };
        await sheetsDB.appendRow('Pedidos', nuevo);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/pedidos/:id', async (req, res) => {
    try {
        const cambios = {
            fecha: req.body.fecha,
            hora: req.body.hora,
            cliente: req.body.cliente,
            orden: req.body.orden,
            productos_json: req.body.productos,
            observaciones: req.body.observaciones
        };
        await safeUpdate('Pedidos', req.params.id, cambios);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/pedidos/:id', async (req, res) => {
    try {
        await sheetsDB.deleteRow('Pedidos', req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- ADMIN: RUTAS (Crear con Backup y Borrar Restaurando) ---

app.post('/api/crear_ruta', async (req, res) => {
    try {
        // VALIDACIÓN: No crear ruta si no hay respaldo de pedidos
        if (!req.body.pedidos_full || !Array.isArray(req.body.pedidos_full) || req.body.pedidos_full.length === 0) {
            throw new Error("Error: No se pudo generar el respaldo de los pedidos. Intente de nuevo.");
        }

        // 1. Guardar Ruta con BACKUP de pedidos en la columna 'pedidos_backup_json'
        const nuevaRuta = {
            id: Date.now(),
            fecha_entrega: req.body.fecha,
            hora_entrega: req.body.hora,
            nombre_ruta: req.body.nombre_ruta,
            detalles_clientes_json: req.body.detalles,
            total_kg_ruta: req.body.total_kg,
            observaciones: req.body.observaciones,
            placa_vehiculo: req.body.placa,
            conductor_asignado: req.body.conductor,
            tipo_comision: req.body.tipo_comision,
            valor_tarifa: req.body.valor_tarifa,
            pedidos_backup_json: JSON.stringify(req.body.pedidos_full), // Guardamos el backup aquí
            estado: 'Asignada'
        };
        await sheetsDB.appendRow('Despachos', nuevaRuta);

        // 2. Limpiar la hoja 'Pedidos'
        const pedidosABorrar = req.body.pedidos_full;
        for (const p of pedidosABorrar) {
            await sheetsDB.deleteRow('Pedidos', p.id).catch(e => console.log('Error borrando pedido:', p.id));
        }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/borrar_ruta/:id', async (req, res) => {
    try {
        // 1. Leer ruta para recuperar backup (Busca por ID exacto)
        const rows = await sheetsDB.readSheet('Despachos');
        const ruta = rows.find(r => String(r.id).trim() === String(req.params.id).trim());

        if (!ruta) {
            return res.status(404).json({ error: "Ruta no encontrada para borrar" });
        }

        // 2. Restaurar Pedidos usando la columna 'pedidos_backup_json' (No importa si es la col 2, solo importa el nombre del encabezado)
        if (ruta.pedidos_backup_json) {
            try {
                const pedidosRestaurar = JSON.parse(ruta.pedidos_backup_json);
                if (Array.isArray(pedidosRestaurar)) {
                    for (const p of pedidosRestaurar) {
                        p.estado = 'Pendiente'; 
                        await sheetsDB.appendRow('Pedidos', p);
                    }
                }
            } catch (e) { console.error('Error restaurando backup:', e); }
        }

        // 3. Eliminar ruta usando el ID original (Requiere ID en Columna 1 del Excel)
        const deleteResult = await sheetsDB.deleteRow('Despachos', ruta.id);
        
        if (deleteResult && deleteResult.error) {
            throw new Error("Error DB al borrar: " + deleteResult.error);
        }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- CONDUCTOR: FINALIZAR ---
app.put('/api/finalizar/:id', upload.single('foto'), async (req, res) => {
    try {
        const cambios = {
            estado: 'Finalizada',
            detalles_clientes_json: req.body.detalles_actualizados,
            gastos_adicionales: req.body.gastos_json,
            total_pagar_conductor: req.body.total_pagar,
            total_kg_entregados_real: req.body.total_kg_entregados_real
        };
        if (req.file) cambios.evidencia_foto = `/uploads/${req.file.filename}`;
        
        // 1. ACTUALIZAR y 2. COPIAR a Historial
        const itemActualizado = await safeUpdate('Despachos', req.params.id, cambios);
        await sheetsDB.appendRow('Historial_Rutas', itemActualizado);
        
        // 3. BORRAR de Despachos
        await sheetsDB.deleteRow('Despachos', itemActualizado.id);

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/editar_ruta/:id', async (req, res) => {
    try {
        const cambios = {
            placa_vehiculo: req.body.placa,
            conductor_asignado: req.body.conductor,
            tipo_comision: req.body.tipo_comision,
            valor_tarifa: req.body.valor_tarifa
        };
        await safeUpdate('Despachos', req.params.id, cambios);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Servidor Logístico en puerto ${PORT}`));