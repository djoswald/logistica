const express = require('express');
const sheetsDB = require('./sheetsService.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

// Configuración de Carpetas para evidencias
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
    const index = rows.findIndex(r => String(r.id).trim() === String(id).trim());
    if (index === -1) throw new Error('No encontrado');
    const updatedRow = { ...rows[index], ...changes };
    await sheetsDB.updateRow(sheet, id, updatedRow);
    return updatedRow;
}

// --- LOGIN ---
app.post('/api/login', async (req, res) => {
    try {
        const users = await sheetsDB.readSheet('Usuarios');
        const user = users.find(u => u.usuario === req.body.user && String(u.password) === String(req.body.pass));
        if (user) res.json({ user });
        else res.status(401).json({ error: 'Credenciales inválidas' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- DATA INICIAL ---
app.get('/api/data', async (req, res) => {
    try {
        const [pedidos, despachos, vehiculos, usuarios] = await Promise.all([
            sheetsDB.readSheet('Pedidos'),
            sheetsDB.readSheet('Despachos'),
            sheetsDB.readSheet('Vehiculos'),
            sheetsDB.readSheet('Usuarios')
        ]);
        const conductores = usuarios.filter(u => (u.rol || '').trim().toLowerCase() === 'conductor');
        res.json({ pedidos, despachos, vehiculos, conductores });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- REPORTE FLETES ---
app.get('/api/reporte_fletes', async (req, res) => {
    try {
        const data = await sheetsDB.readSheet('Reporte_Fletes');
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- HISTORIAL ---
app.get('/api/historial', async (req, res) => {
    try {
        const hist = await sheetsDB.readSheet('Historial_Rutas');
        res.json(hist);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- PEDIDOS (CRUD COMPLETO) ---
app.post('/api/pedidos', async (req, res) => {
    try {
        const prodString = req.body.productos_json || (typeof req.body.productos === 'string' ? req.body.productos : JSON.stringify(req.body.productos));
        const nuevo = { 
            id: Date.now().toString(),
            Fecha: req.body.fecha,
            Hora: req.body.hora,
            Cliente: req.body.cliente,
            Orden: req.body.orden,
            Productos: prodString,
            Observaciones: req.body.observaciones,
            Estado: 'Pendiente'
        };
        await sheetsDB.appendRow('Pedidos', nuevo);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/pedidos/:id', async (req, res) => {
    try {
        const cambios = { ...req.body };
        if(cambios.productos || cambios.Productos) {
            const p = cambios.productos || cambios.Productos;
            const pStr = typeof p === 'string' ? p : JSON.stringify(p);
            cambios.Productos = pStr;
        }
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

// --- RUTAS / DESPACHOS (CON REPORTE DE FLETES DETALLADO) ---
app.post('/api/crear_ruta', async (req, res) => {
    try {
        const rutaId = Date.now().toString();
        
        // Backup para restaurar pedidos si se anula la ruta
        const backupPedidos = req.body.pedidos_full.map(p => ({ 
            id: p.id, 
            estado_previo: 'Pendiente',
            productos_backup: p.productos_json || JSON.stringify(p.productos) 
        }));

        const nuevaRuta = {
            id: rutaId,
            nombre_ruta: req.body.nombre_ruta,
            fecha: req.body.fecha,
            hora: req.body.hora,
            placa_vehiculo: req.body.placa,
            conductor_asignado: req.body.conductor,
            tipo_comision: req.body.tipo_comision,
            valor_tarifa: req.body.valor_tarifa,
            total_conductor_estimado: req.body.total_conductor_estimado,
            tipo_flete: req.body.tipo_flete,
            valor_flete: req.body.valor_flete,
            total_flete_estimado: req.body.total_flete_estimado,
            total_kg_ruta: req.body.total_kg,
            estado: 'Asignada',
            detalles_clientes_json: req.body.detalles,
            pedidos_backup_json: JSON.stringify(backupPedidos),
            observaciones: req.body.observaciones
        };

        await sheetsDB.appendRow('Despachos', nuevaRuta);

        // --- REGISTRO DETALLADO EN REPORTE_FLETES ---
        if (req.body.pedidos_full) {
            const totalKgRuta = parseFloat(req.body.total_kg) || 1; 

            for (const p of req.body.pedidos_full) {
                // Actualizar estado del pedido a "En Ruta"
                await safeUpdate('Pedidos', p.id, { Estado: 'En Ruta' });
                
                const pesoPedido = parseFloat(p.total_kg) || 0;
                
                // Cálculo proporcional del flete y pago según el peso de cada pedido
                let costoFlete = (req.body.tipo_flete === 'variable') 
                    ? (pesoPedido * req.body.valor_flete) 
                    : (pesoPedido / totalKgRuta) * req.body.valor_flete;
                    
                let costoCond = (req.body.tipo_comision === 'variable') 
                    ? (pesoPedido * req.body.valor_tarifa) 
                    : (pesoPedido / totalKgRuta) * req.body.valor_tarifa;

                const registroReporte = {
                    id: `${rutaId}_${p.id}`,
                    id_ruta: rutaId,
                    fecha: req.body.fecha,
                    cliente: p.cliente,
                    orden: p.orden,
                    peso_kg: pesoPedido,
                    tipo_flete: req.body.tipo_flete,
                    valor_base_flete: req.body.valor_flete,
                    costo_flete_total: Math.round(costoFlete),
                    tipo_pago_cond: req.body.tipo_comision,
                    valor_base_cond: req.body.valor_tarifa,
                    pago_conductor_estimado: Math.round(costoCond),
                    observaciones: p.observaciones || ''
                };
                await sheetsDB.appendRow('Reporte_Fletes', registroReporte);
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- BORRAR RUTA (RESTAURA PEDIDOS Y LIMPIA REPORTES) ---
app.delete('/api/borrar_ruta/:id', async (req, res) => {
    try {
        const rows = await sheetsDB.readSheet('Despachos');
        const rutaData = rows.find(r => String(r.id).trim() === String(req.params.id).trim());

        if(rutaData && rutaData.pedidos_backup_json) {
            const pedidosBackup = JSON.parse(rutaData.pedidos_backup_json);
            for (const pBackup of pedidosBackup) {
                await safeUpdate('Pedidos', pBackup.id, { Estado: 'Pendiente' });
            }
        }

        // Limpieza de reportes de fletes asociados a esta ruta
        const reportes = await sheetsDB.readSheet('Reporte_Fletes');
        const reportesABorrar = reportes.filter(r => String(r.id_ruta).trim() === String(req.params.id).trim());
        for (const item of reportesABorrar) {
            await sheetsDB.deleteRow('Reporte_Fletes', item.id);
        }

        await sheetsDB.deleteRow('Despachos', req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- FINALIZAR RUTA (AÑADE A HISTORIAL Y ELIMINA DE ACTIVAS) ---
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
        
        const itemActualizado = await safeUpdate('Despachos', req.params.id, cambios);
        
        // Mover registro al historial
        await sheetsDB.appendRow('Historial_Rutas', itemActualizado);
        
        // Eliminar de rutas activas
        await sheetsDB.deleteRow('Despachos', itemActualizado.id);

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));