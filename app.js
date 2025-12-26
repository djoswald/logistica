let user = JSON.parse(localStorage.getItem('sidma_user')) || null;
let rawDespachos = [];
let rawPedidos = [];
let vehiculosList = [];
let conductoresList = [];
let historyData = [];

// Bloqueo de seguridad para evitar duplicados
let isProcessingAction = false;

// Variables Paginación
let curHistPage = 1;
const itemsPerPage = 5;
let currentHistoryFiltered = []; 

// Variables Memoria (Autocompletado)
let knownClients = new Set();
let knownProducts = new Set();

// Variable para el Tiquete actual (WhatsApp)
let currentTicketRoute = null;

const LOCALE = 'es-CO';
const TIMEZONE = 'America/Bogota';
const fmtMoney = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Formatea fechas ISO a formato local DD/MM/YYYY
 */
const fmtDate = (iso) => { 
    if(!iso) return ''; 
    if(iso.includes('-') && !iso.includes('T')) { 
        const [y,m,d]=iso.split('-'); 
        return `${d}/${m}/${y}`; 
    } 
    try {
        return new Date(iso).toLocaleDateString(LOCALE, { timeZone: TIMEZONE }); 
    } catch {
        return iso;
    }
};

/**
 * Formatea horas ISO o strings a HH:mm
 */
const fmtTime = (raw) => { 
    if(!raw) return ''; 
    if(raw.includes('T')) { 
        try {
            return new Date(raw).toLocaleTimeString('en-GB',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit'});
        } catch {
            const parts = raw.split('T');
            return parts.length > 1 ? parts[1].substring(0,5) : raw.substring(0,5);
        } 
    } 
    return raw.length > 5 ? raw.substring(0,5) : raw; 
};

/**
 * Obtiene la fecha actual en formato ISO para Colombia
 */
const getBogotaDateISO = () => { 
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: TIMEZONE})); 
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); 
};

/**
 * Configura los rangos de fecha predeterminados (Mes Actual) para los filtros de historial
 */
const initHistoryFilters = () => {
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: TIMEZONE}));
    const y = now.getFullYear();
    const m = now.getMonth();
    
    // Primer día del mes
    const firstDay = new Date(y, m, 1);
    // Último día del mes
    const lastDay = new Date(y, m + 1, 0);

    const toISODate = (d) => {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };

    const inputIni = document.getElementById('histIni');
    const inputFin = document.getElementById('histFin');

    if (inputIni) inputIni.value = toISODate(firstDay);
    if (inputFin) inputFin.value = toISODate(lastDay);
};

// --- INICIO APP ---
document.addEventListener('DOMContentLoaded', () => { 
    if(!user) document.getElementById('loginScreen').style.display = 'flex'; 
    else initApp(); 
});

/**
 * Manejo del formulario de Login
 */
document.getElementById('loginForm').addEventListener('submit', async(e) => {
    e.preventDefault(); 
    if(isProcessingAction) return;
    isProcessingAction = true;

    const u = document.getElementById('user').value; 
    const p = document.getElementById('pass').value;
    try { 
        const res = await fetch('/api/login', {
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify({user:u, pass:p})
        }); 
        if(res.ok){ 
            const d = await res.json(); 
            localStorage.setItem('sidma_user', JSON.stringify(d.user)); 
            location.reload(); 
        } else { 
            Swal.fire('Error', 'Credenciales incorrectas', 'error'); 
        } 
    } catch { 
        Swal.fire('Error', 'Sin conexión', 'error'); 
    } finally {
        isProcessingAction = false;
    }
});

async function initApp(){
    document.getElementById('loginScreen').style.display='none'; 
    document.getElementById('appLayout').style.display='block';
    document.getElementById('uName').textContent = user.nombre; 
    document.getElementById('uRole').textContent = user.rol.toUpperCase();
    document.querySelectorAll('.role-section').forEach(el => el.style.display='none'); 
    document.getElementById(`view-${user.rol}`).style.display='block';
    
    // Inicializar filtros de fecha antes de cargar datos
    initHistoryFilters();
    
    await loadData();
}

window.refreshData = async () => { 
    if(isProcessingAction) return;
    await loadData(); 
    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Datos actualizados', timer:1500, showConfirmButton:false}); 
};

async function loadData(){
    const res = await fetch('/api/data'); 
    const d = await res.json();
    vehiculosList = (d.vehiculos || []).map(processRow);
    conductoresList = (d.conductores || []).map(processRow);
    rawDespachos = (d.despachos || []).map(processRow);
    rawPedidos = (d.pedidos || []).map(p => { 
        let item = processRow(p); 
        try { 
            item.productos = JSON.parse(item.productos_json || item.productos); 
        } catch { 
            item.productos = []; 
        } 
        let t = 0; 
        item.productos.forEach(x => t += parseFloat(x.kg_plan)||0); 
        item.total_kg = t; 
        return item; 
    });
    
    extractUniqueData();
    renderViews();

    fetch('/api/historial')
        .then(r => r.json())
        .then(hist => {
            historyData = hist.map(processRow);
            extractUniqueData(); 
        })
        .catch(e => console.error("Error historial:", e));
}

function extractUniqueData() {
    rawPedidos.forEach(p => {
        if(p.cliente) knownClients.add(p.cliente);
        if(p.productos) p.productos.forEach(prod => { if(prod.producto) knownProducts.add(prod.producto); });
    });
    updateAutocompleteLists();
}

function updateAutocompleteLists() {
    const dlC = document.getElementById('listClientes');
    if(dlC) {
        dlC.innerHTML = '';
        knownClients.forEach(c => { const opt = document.createElement('option'); opt.value = c; dlC.appendChild(opt); });
    }
    const dlP = document.getElementById('listProductos');
    if(dlP) {
        dlP.innerHTML = '';
        knownProducts.forEach(p => { const opt = document.createElement('option'); opt.value = p; dlP.appendChild(opt); });
    }
}

function processRow(r) { 
    let item = {}; 
    for(let k in r) item[k.toLowerCase().trim()] = r[k]; 
    if (item.detalles_clientes_json) {
        try { item.detalles = JSON.parse(item.detalles_clientes_json); } catch { item.detalles = []; } 
    }
    if (item.gastos_adicionales) {
        try { item.gastos = JSON.parse(item.gastos_adicionales); } catch { item.gastos = []; } 
    }
    return item; 
}

function renderViews(){ 
    if(user.rol === 'operador') renderOperador(); 
    if(user.rol === 'admin') renderAdmin(); 
    if(user.rol === 'conductor') renderConductor(); 
}

// --- OPERADOR ---
function renderOperador() {
    const c = document.getElementById('listPedidosOperador'); c.innerHTML = '';
    rawPedidos.forEach(p => {
        let prodsList = p.productos.map(x => `<li>${x.producto} (${x.kg_plan}kg)</li>`).join('');
        c.innerHTML += `<div class="card item-card status-creada">
            <div style="display:flex; justify-content:space-between"><h4>${p.cliente}</h4>
            <div><button onclick="openPedidoModal('${p.id}')" class="btn-sec small"><i class="fa-solid fa-pen"></i></button>
            <button onclick="borrarPedido(event, '${p.id}')" class="btn-del small"><i class="fa-solid fa-trash"></i></button></div></div>
            <p>Ord: ${p.orden || '--'} | ${fmtDate(p.fecha)}</p>
            <ul style="font-size:0.8rem; padding-left:20px; color:#ccc;">${prodsList}</ul>
            <div style="text-align:right; font-weight:bold; border-top:1px solid #444; padding-top:5px;">Total: ${fmtNum.format(p.total_kg)} Kg</div>
        </div>`;
    });

    const activesOp = document.getElementById('listRutasActivasOperador');
    if(activesOp) {
        activesOp.innerHTML = '';
        rawDespachos.filter(x => x.estado === 'Asignada').forEach(r => {
            activesOp.innerHTML += `<div class="card item-card status-asignada">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;"><h4>${r.nombre_ruta}</h4><span class="badge">EN RUTA</span></div>
                <p><i class="fa-solid fa-truck"></i> ${r.placa_vehiculo} | ${r.conductor_asignado}</p>
                <div class="mt"><button onclick="openTicket('${r.id}')" class="btn-sec" style="width:100%">🖨️ Ver Planilla</button></div>
            </div>`;
        });
    }
}

// --- ADMIN ---
function renderAdmin() {
    const pendingNotice = document.getElementById('pendingNotice');
    if (pendingNotice) {
        const count = rawPedidos.length;
        pendingNotice.innerHTML = `TIENES <strong>${count}</strong> PEDIDOS PENDIENTES POR ASIGNAR`;
        pendingNotice.style.display = count > 0 ? 'block' : 'none';
    }
    const actives = document.getElementById('listRutasActivas'); actives.innerHTML = '';
    rawDespachos.filter(x => x.estado === 'Asignada').forEach(r => {
        actives.innerHTML += `<div class="card item-card status-asignada">
            <div style="display:flex; justify-content:space-between"><h4>${r.nombre_ruta}</h4>
            <button onclick="borrarRuta(event, '${r.id}')" class="btn-del small"><i class="fa-solid fa-trash"></i></button></div>
            <p>${r.placa_vehiculo} | ${r.conductor_asignado}</p>
            <div class="grid-2 mt"><button onclick="openTicket('${r.id}')" class="btn-sec">🖨️ Ver</button>
            <button onclick="editRutaModal('${r.id}')" class="btn-sec">✏️ Editar</button></div>
        </div>`;
    });
}

// --- CONDUCTOR ---
function renderConductor() {
    const l = rawDespachos.filter(x => x.conductor_asignado === user.nombre && x.estado === 'Asignada');
    const c = document.getElementById('listMisRutas'); c.innerHTML = '';
    l.forEach(r => {
        c.innerHTML += `<div class="card item-card status-asignada">
            <h3>${r.nombre_ruta}</h3>
            <p><i class="fa-solid fa-truck"></i> ${r.placa_vehiculo} | <strong>${fmtNum.format(r.total_kg_ruta)} Kg</strong></p>
            <div class="grid-2 mt"><button onclick="openTicket('${r.id}')" class="btn-sec">🖨️ Tiquete</button>
            <button onclick="openFin('${r.id}')" class="btn-primary">FINALIZAR</button></div>
        </div>`;
    });
}

// --- FUNCIONES DE PEDIDO ---
window.openPedidoModal = (id = null) => {
    const modal = document.getElementById('modalPedido'); 
    const form = document.getElementById('formPedido'); 
    const container = document.getElementById('prodContainer');
    form.reset(); container.innerHTML = ''; 
    document.getElementById('pTotalKg').innerText = '0'; 
    document.getElementById('editPedidoId').value = '';
    if(id) {
        const p = rawPedidos.find(x => String(x.id) === String(id)); if(!p) return;
        document.getElementById('editPedidoId').value = id; 
        document.getElementById('pFecha').value = p.fecha ? p.fecha.split('T')[0] : ''; 
        document.getElementById('pHora').value = fmtTime(p.hora); 
        document.getElementById('pCliente').value = p.cliente; 
        document.getElementById('pOrden').value = p.orden; 
        document.getElementById('pObs').value = p.observaciones || '';
        p.productos.forEach(prod => { addProdRow(container, prod.producto, prod.kg_plan); }); 
        calcTotalPedido();
    } else {
        document.getElementById('pFecha').value = getBogotaDateISO(); addProdRow(container);
    }
    modal.style.display = 'flex';
};

window.addProdRow = (containerOrBtn, name='', kg='') => {
    let container = (containerOrBtn.id === 'prodContainer') ? containerOrBtn : document.getElementById('prodContainer');
    const row = document.createElement('div'); row.className = 'prod-row';
    row.innerHTML = `<input type="text" class="pr-name" placeholder="Producto" style="flex:2" value="${name}" list="listProductos" autocomplete="off" required><input type="number" class="pr-kg" placeholder="Kg" oninput="calcTotalPedido()" style="flex:1" value="${kg}" required><button type="button" onclick="this.parentElement.remove(); calcTotalPedido()" class="btn-del small">x</button>`;
    container.appendChild(row);
};

window.calcTotalPedido = () => { 
    let t = 0; 
    document.querySelectorAll('#prodContainer .pr-kg').forEach(i => t += parseFloat(i.value) || 0); 
    document.getElementById('pTotalKg').innerText = fmtNum.format(t); 
};

document.getElementById('formPedido').addEventListener('submit', async(e) => {
    e.preventDefault(); 
    if(isProcessingAction) return;
    isProcessingAction = true;

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    const prods = []; 
    document.querySelectorAll('#prodContainer .prod-row').forEach(pr => { 
        const n = pr.querySelector('.pr-name').value; 
        const k = pr.querySelector('.pr-kg').value; 
        if(n && k) prods.push({ producto: n, kg_plan: k, kg_ent: k, estado: 'Pendiente' }); 
    });
    
    if(prods.length === 0) { btn.disabled = false; isProcessingAction = false; return Swal.fire('Error', 'Agrega productos', 'warning'); }

    const body = { 
        fecha: document.getElementById('pFecha').value, 
        hora: document.getElementById('pHora').value, 
        cliente: document.getElementById('pCliente').value, 
        orden: document.getElementById('pOrden').value, 
        observaciones: document.getElementById('pObs').value, 
        productos: JSON.stringify(prods) 
    };
    const editId = document.getElementById('editPedidoId').value; 
    const url = editId ? `/api/pedidos/${editId}` : '/api/pedidos'; 
    const method = editId ? 'PUT' : 'POST';

    Swal.fire({title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    try {
        const res = await fetch(url, {method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
        if(res.ok) { closeModal('modalPedido'); await loadData(); Swal.fire('Éxito','','success'); }
    } catch(e) {
        Swal.fire('Error', 'No se pudo guardar', 'error');
    } finally {
        btn.disabled = false;
        isProcessingAction = false;
    }
});

// --- FUNCIONES DE RUTA CON CORTE DETALLADO POR PRODUCTO ---
window.openCrearRutaModal = () => {
    document.getElementById('formRutaAdmin').reset();
    document.getElementById('rFecha').value = getBogotaDateISO();
    document.getElementById('rHora').value = new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
    
    document.getElementById('vehCapacidad').innerText = '---';
    document.getElementById('overloadWarning').style.display = 'none';

    const pool = document.getElementById('poolPedidosAdmin'); pool.innerHTML = '';
    rawPedidos.forEach(p => {
        let prodsUI = '';
        p.productos.forEach((pr, idx) => {
            prodsUI += `
            <div style="display:flex; align-items:center; gap:5px; margin-top:2px; padding-left:22px; font-size:0.75rem;">
                <span style="flex:2; color:#94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">• ${pr.producto}</span>
                <input type="number" class="manual-prod-kg" 
                       data-ped-id="${p.id}" 
                       data-prod-idx="${idx}" 
                       data-orig="${pr.kg_plan}" 
                       value="${pr.kg_plan}" 
                       oninput="calcRutaAdmin()" 
                       style="width:55px; height: 22px; padding: 2px; text-align:right; font-size:0.7rem; margin-bottom:0;" 
                       step="0.1" min="0">
            </div>`;
        });

        pool.innerHTML += `
        <div class="pedido-check-card" style="padding:5px 8px; border-bottom:1px solid #334155; margin-bottom:4px; background: rgba(255,255,255,0.03);">
            <label class="check-label" style="display:flex; align-items:flex-start; gap:8px; cursor:pointer; margin-bottom: 2px;">
                <input type="checkbox" class="chk-pedido" value="${p.id}" onchange="calcRutaAdmin()" style="margin-top: 3px; width: 14px; height: 14px;">
                <div style="font-size:0.8rem; line-height: 1.2;">
                    <strong>${p.cliente}</strong> <span style="color:#94a3b8;">(Ord: ${p.orden})</span> 
                    <br>
                    <span style="color:var(--orange); font-weight:bold;"><span id="dyn-kg-${p.id}">${fmtNum.format(p.total_kg)}</span> Kg</span>
                    ${p.observaciones ? `<div style="font-style:italic; font-size:0.75rem; color:#64748b; margin-top:2px; padding: 2px 4px; background: rgba(0,0,0,0.15); border-radius: 3px;">Obs: ${p.observaciones}</div>` : ''}
                </div>
            </label>
            <div class="prod-breakdown" id="breakdown-${p.id}" style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 3px;">
                ${prodsUI}
            </div>
        </div>`;
    });
    const sP = document.getElementById('rPlaca'); sP.innerHTML = '<option value="">Vehículo...</option>'; vehiculosList.forEach(v => sP.innerHTML += `<option value="${v.placa}">${v.placa}</option>`);
    const sC = document.getElementById('rCond'); sC.innerHTML = '<option value="">Conductor...</option>'; conductoresList.forEach(c => sC.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`);
    document.getElementById('modalCrearRuta').style.display = 'flex';
};

window.calcRutaAdmin = () => {
    let count = 0, kgTotalRuta = 0;
    
    document.querySelectorAll('.chk-pedido').forEach(chk => {
        const pId = chk.value;
        const inputs = document.querySelectorAll(`.manual-prod-kg[data-ped-id="${pId}"]`);
        let kgPedidoActual = 0;
        
        inputs.forEach(inp => {
            kgPedidoActual += parseFloat(inp.value) || 0;
            // Habilitar/Deshabilitar según el checkbox del pedido
            inp.disabled = !chk.checked;
        });

        // Actualizar visualmente el peso del pedido en la lista según los inputs
        const dynKgLabel = document.getElementById(`dyn-kg-${pId}`);
        if(dynKgLabel) dynKgLabel.innerText = fmtNum.format(kgPedidoActual);

        if (chk.checked) {
            count++;
            kgTotalRuta += kgPedidoActual;
        }
    });

    document.getElementById('selCount').innerText = count; 
    document.getElementById('selKg').innerText = fmtNum.format(kgTotalRuta);
    
    const placa = document.getElementById('rPlaca').value;
    const veh = vehiculosList.find(v => v.placa === placa);
    if(veh) {
        const cap = parseFloat(veh.capacidad) || 0;
        document.getElementById('vehCapacidad').innerText = fmtNum.format(cap);
        document.getElementById('overloadWarning').style.display = (kgTotalRuta > cap && cap > 0) ? 'block' : 'none';
    }
};

document.getElementById('formRutaAdmin').addEventListener('submit', async (e) => {
    e.preventDefault();
    if(isProcessingAction) return;
    isProcessingAction = true;

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    const chks = document.querySelectorAll('.chk-pedido:checked');
    if (chks.length === 0) { btn.disabled = false; isProcessingAction = false; return Swal.fire('Error', 'Selecciona al menos un pedido', 'warning'); }

    const placa = document.getElementById('rPlaca').value;
    let totalKgRutaFinal = 0;
    const detallesRuta = [];
    const pedidosParaProcesar = []; 

    Swal.fire({ title: 'Procesando pedidos y cortes específicos...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        for (const chk of chks) {
            const pId = chk.value;
            const pOriginal = rawPedidos.find(x => String(x.id) === String(pId));
            if (!pOriginal) continue;

            const inputs = document.querySelectorAll(`.manual-prod-kg[data-ped-id="${pId}"]`);
            let prodsCargados = [];
            let prodsExcedente = [];
            let totalCargadoPedido = 0;
            let huboCorte = false;

            inputs.forEach(inp => {
                const idx = parseInt(inp.dataset.prodIdx);
                const kgACargar = parseFloat(inp.value) || 0;
                const kgOriginal = parseFloat(inp.dataset.orig);
                const refProducto = pOriginal.productos[idx];

                if (kgACargar > 0) {
                    prodsCargados.push({
                        ...refProducto,
                        kg_plan: kgACargar,
                        kg_ent: kgACargar
                    });
                    totalCargadoPedido += kgACargar;
                }

                if (kgACargar < kgOriginal) {
                    huboCorte = true;
                    prodsExcedente.push({
                        ...refProducto,
                        kg_plan: (kgOriginal - kgACargar).toFixed(2),
                        kg_ent: (kgOriginal - kgACargar).toFixed(2),
                        estado: 'Pendiente'
                    });
                }
            });

            if (totalCargadoPedido === 0) continue;

            // Si hubo corte, crear el pedido "Hijo" con los productos/kilos restantes
            if (huboCorte) {
                await fetch('/api/pedidos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...pOriginal,
                        id: null,
                        orden: pOriginal.orden + "-C",
                        productos: JSON.stringify(prodsExcedente),
                        observaciones: `Excedente cortado del pedido original (Ruta: ${document.getElementById('rNombre').value})`
                    })
                });

                // Actualizar pedido original para que solo se mueva lo que realmente se cargó
                await fetch(`/api/pedidos/${pOriginal.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...pOriginal,
                        productos: JSON.stringify(prodsCargados)
                    })
                });
            }

            const pAsignar = { ...pOriginal, productos: prodsCargados, total_kg: totalCargadoPedido };
            detallesRuta.push({ 
                cliente: pAsignar.cliente, 
                orden: pAsignar.orden, 
                productos: pAsignar.productos, 
                fecha_original: pAsignar.fecha, 
                hora_original: pAsignar.hora,
                observaciones: pAsignar.observaciones // Recuperamos observaciones de pedido
            });
            totalKgRutaFinal += totalCargadoPedido;
            pedidosParaProcesar.push(pAsignar);
        }

        const bodyRuta = {
            nombre_ruta: document.getElementById('rNombre').value,
            fecha: document.getElementById('rFecha').value,
            hora: document.getElementById('rHora').value,
            placa: placa,
            conductor: document.getElementById('rCond').value,
            tipo_comision: document.getElementById('rTipo').value,
            valor_tarifa: document.getElementById('rValor').value,
            total_kg: totalKgRutaFinal,
            detalles: JSON.stringify(detallesRuta),
            pedidos_full: pedidosParaProcesar,
            observaciones: document.getElementById('rObs') ? document.getElementById('rObs').value : '' // Recuperamos observaciones de ruta
        };

        const res = await fetch('/api/crear_ruta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyRuta)
        });

        if (res.ok) {
            closeModal('modalCrearRuta');
            await loadData();
            Swal.fire('Ruta Creada', `Se procesó la carga detallada correctamente.`, 'success');
        }
    } catch (error) {
        Swal.fire('Error', 'No se pudo procesar la ruta', 'error');
    } finally {
        btn.disabled = false;
        isProcessingAction = false;
    }
});

// --- FINALIZAR RUTA CON CORTE DE SALDO ---
window.submitFinalizar = async () => {
    if(isProcessingAction) return;
    isProcessingAction = true;

    const btn = document.querySelector('#modalFinalizar .btn-primary:last-child');
    btn.disabled = true;

    const id = document.getElementById('finId').value;
    const r = rawDespachos.find(x => String(x.id) === String(id));
    if (!r) { btn.disabled = false; isProcessingAction = false; return; }

    const faltantes = [];
    const detallesActualizados = JSON.parse(JSON.stringify(r.detalles)); 

    detallesActualizados.forEach((clienteObj, ic) => {
        let productosFaltantes = [];
        clienteObj.productos.forEach((p, ip) => {
            const inputVal = document.querySelector(`.kg-ent-input[data-ic="${ic}"][data-ip="${ip}"]`);
            const kgEnt = parseFloat(inputVal.value) || 0;
            const kgPlan = parseFloat(p.kg_plan);

            // Guardamos ambos valores para el historial y tiquetes
            p.kg_ent = kgEnt;
            p.kg_plan_orig = kgPlan; // Preservamos lo que debía ser
            p.estado = kgEnt >= kgPlan ? 'Entregado' : 'Incompleto';

            if (kgEnt < kgPlan) {
                const diff = kgPlan - kgEnt;
                productosFaltantes.push({
                    producto: p.producto,
                    kg_plan: diff,
                    kg_ent: diff,
                    estado: 'Pendiente'
                });
            }
        });

        if (productosFaltantes.length > 0) {
            faltantes.push({
                cliente: clienteObj.cliente,
                orden: clienteObj.orden + "-S",
                fecha: getBogotaDateISO(),
                hora: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                productos: productosFaltantes,
                observaciones: `Saldo pendiente de manifiesto #${r.id}`
            });
        }
    });

    Swal.fire({ title: 'Procesando entrega...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        for (const f of faltantes) {
            await fetch('/api/pedidos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...f, productos: JSON.stringify(f.productos) })
            });
        }

        const g = [];
        document.querySelectorAll('#gastosContainer .mini-grid').forEach(e => {
            const desc = e.querySelector('.g-desc').value;
            const val = e.querySelector('.g-val').value;
            if(desc && val) g.push({ desc, val });
        });

        const fd = new FormData();
        fd.append('detalles_actualizados', JSON.stringify(detallesActualizados));
        fd.append('gastos_json', JSON.stringify(g));
        fd.append('total_pagar', document.getElementById('finTotal').innerText.replace(/[$.]/g, '').replace(',', '.').trim());
        fd.append('total_kg_entregados_real', document.getElementById('finKg').innerText.replace(/\./g, '').replace(',', '.').trim());
        
        const fotoFile = document.getElementById('finFoto').files[0];
        if (fotoFile) fd.append('foto', fotoFile);

        const res = await fetch(`/api/finalizar/${id}`, { method: 'PUT', body: fd });
        
        if (res.ok) {
            closeModal('modalFinalizar');
            await loadData();
            Swal.fire({
                icon: 'success',
                title: 'Ruta Finalizada',
                text: faltantes.length > 0 ? `Se crearon ${faltantes.length} pedidos de saldo por el corte.` : 'Entrega completa registrada.'
            });
        }
    } catch (e) {
        Swal.fire('Error', 'No se pudo completar la operación', 'error');
    } finally {
        btn.disabled = false;
        isProcessingAction = false;
    }
};

// --- TIQUETES Y WHATSAPP ---
window.openTicket = (id) => {
    const r = rawDespachos.find(x => String(x.id) === String(id)) || historyData.find(x => String(x.id) === String(id));
    if(!r) return;
    currentTicketRoute = r;
    
    const esFinalizada = (r.estado === 'Finalizada' || r.fecha_entrega);
    const fechaSalida = fmtDate(r.fecha || r.fecha_entrega);
    const horaCargue = fmtTime(r.hora || r.hora_entrega);
    let listHTML = '';
    
    r.detalles.forEach(c => {
        listHTML += `<div style="margin-top:8px; border-bottom:1px solid #000; padding-bottom:2px;">
            <div style="display:flex; justify-content:space-between;">
                <strong>${c.cliente.toUpperCase()}</strong>
                <span>Ord: ${c.orden||'--'}</span>
            </div>
            ${c.observaciones ? `<div style="font-size:10px; color:#555;">Obs: ${c.observaciones}</div>` : ''}
        </div>`;
        
        c.productos.forEach(p => { 
            const kgEnt = p.kg_ent !== undefined ? p.kg_ent : p.kg_plan;
            const kgPlan = p.kg_plan_orig || p.kg_plan;
            
            let infoKg = `<span>${fmtNum.format(kgEnt)} Kg</span>`;
            if (esFinalizada && kgEnt < kgPlan) {
                infoKg = `<span style="color:red;">${fmtNum.format(kgEnt)} / ${fmtNum.format(kgPlan)} Kg (Parcial)</span>`;
            }

            listHTML += `<div style="display:flex; justify-content:space-between; font-size:11px; padding-left:5px">
                <span>- ${p.producto}</span>
                ${infoKg}
            </div>`; 
        });
    });

    // Cálculos de costos para tiquete conductor
    let costosHTML = '';
    if (esFinalizada) {
        const kgReal = parseFloat(r.total_kg_entregados_real) || 0;
        const tarifa = parseFloat(r.valor_tarifa) || 0;
        const comision = (r.tipo_comision === 'variable') ? (kgReal * tarifa) : tarifa;
        
        let gastosDetalle = '';
        let totalGastos = 0;
        if (r.gastos && Array.isArray(r.gastos)) {
            r.gastos.forEach(g => {
                const v = parseFloat(g.val) || 0;
                totalGastos += v;
                gastosDetalle += `<div style="display:flex; justify-content:space-between; font-size:10px; color:#666;">
                    <span>   > ${g.desc}:</span><span>${fmtMoney.format(v)}</span>
                </div>`;
            });
        }
        
        const totalPagar = comision + totalGastos;

        costosHTML = `
            <div style="margin-top:10px; border-top:1px dashed #000; padding-top:5px;">
                <div style="display:flex; justify-content:space-between; font-size:11px;">
                    <span>Comisión (${r.tipo_comision}):</span><strong>${fmtMoney.format(comision)}</strong>
                </div>
                ${gastosDetalle}
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-top:5px; border-top:1px solid #000;">
                    <strong>TOTAL A PAGAR:</strong><strong>${fmtMoney.format(totalPagar)}</strong>
                </div>
            </div>
        `;
    }

    document.getElementById('ticketPreviewContent').innerHTML = `
        <div style="text-align:center;"><h2 style="margin:0">AGROLLANOS</h2><p style="margin:0; font-size:11px;">MANIFIESTO #${r.id.toString().slice(-4)}</p></div>
        <div style="font-size:12px; margin-top:5px;">
            <div style="display:flex; justify-content:space-between;"><span>Fecha Salida:</span><span>${fechaSalida}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Hora Cargue:</span><span>${horaCargue}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Ruta:</span><strong>${r.nombre_ruta}</strong></div>
            <div style="display:flex; justify-content:space-between;"><span>Conductor:</span><span>${r.conductor_asignado}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Placa:</span><span>${r.placa_vehiculo}</span></div>
        </div>
        <hr style="border:none; border-top:1px solid #000;">
        ${listHTML}
        <hr style="border:none; border-top:1px solid #000;">
        <div style="display:flex; justify-content:space-between; font-weight:bold;">
            <span>TOTAL CARGA:</span>
            <span>${fmtNum.format(r.total_kg_entregados_real || r.total_kg_ruta)} Kg</span>
        </div>

        ${r.observaciones ? `<div style="font-size:11px; margin-top:8px; background:#f8fafc; padding:8px; border-left: 3px solid var(--orange); color: #334155;"><strong>Observaciones:</strong> ${r.observaciones}</div>` : ''}

        ${costosHTML}
    `;
    document.getElementById('modalTicket').style.display = 'flex';
};

window.sendWhatsAppTicket = () => {
    if (!currentTicketRoute) return;
    const r = currentTicketRoute;
    const esFinalizada = (r.estado === 'Finalizada' || r.fecha_entrega);
    
    let msg = `*AGROLLANOS - MANIFIESTO #${r.id.toString().slice(-4)}*\n`;
    msg += `📅 *Fecha Salida:* ${fmtDate(r.fecha || r.fecha_entrega)}\n`;
    msg += `⏰ *Hora Cargue:* ${fmtTime(r.hora || r.hora_entrega)}\n`;
    msg += `🛞 *Conductor:* ${r.conductor_asignado}\n`;
    msg += `🚛 *Placa:* ${r.placa_vehiculo}\n`;
    msg += `📍 *Ruta:* ${r.nombre_ruta}\n`;
    
    msg += `\n*DETALLE DE CARGA:*\n`;
    
    r.detalles.forEach(c => { 
        msg += `• *${c.cliente.toUpperCase()}* - Ord: ${c.orden || 'S/N'}\n`; 
        if (c.observaciones) msg += `   _(Obs: ${c.observaciones})_\n`;
        
        c.productos.forEach(p => { 
            const kgEnt = p.kg_ent !== undefined ? p.kg_ent : p.kg_plan;
            const kgPlan = p.kg_plan_orig || p.kg_plan;
            
            if (esFinalizada && kgEnt < kgPlan) {
                msg += `   - ${p.producto}: *${fmtNum.format(kgEnt)}* / ${fmtNum.format(kgPlan)} Kg (PARCIAL)\n`;
            } else {
                msg += `   - ${p.producto}: ${fmtNum.format(parseFloat(kgEnt))} Kg\n`; 
            }
        }); 
    });
    
    msg += `\n⚖️ *Total:* ${fmtNum.format(r.total_kg_entregados_real || r.total_kg_ruta)} Kg\n`;

    if (r.observaciones) msg += `📝 *Observaciones:* ${r.observaciones}\n`;
    
    if (esFinalizada) {
        const kgReal = parseFloat(r.total_kg_entregados_real) || 0;
        const tarifa = parseFloat(r.valor_tarifa) || 0;
        const comision = (r.tipo_comision === 'variable') ? (kgReal * tarifa) : tarifa;
        let tGastos = 0;
        if (r.gastos) r.gastos.forEach(g => tGastos += parseFloat(g.val)||0);
        
        msg += `\n\n*RESUMEN PAGO CONDUCTOR:*`;
        msg += `\n💵 Comisión: ${fmtMoney.format(comision)}`;
        if (r.gastos && r.gastos.length > 0) {
            msg += `\n⛽ Gastos: ${fmtMoney.format(tGastos)}`;
        }
        msg += `\n✅ *TOTAL:* ${fmtMoney.format(comision + tGastos)}`;
    }
    
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
};

window.printNow = () => {
    const content = document.getElementById('ticketPreviewContent').innerHTML;
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    printWindow.document.write(`
        <html>
        <head>
            <style>
                @page { margin: 0; }
                body { 
                    width: 76mm; 
                    margin: 0; 
                    padding: 5mm; 
                    font-family: 'Courier New', Courier, monospace; 
                    font-size: 13px; 
                    color: black;
                }
                h2 { text-align: center; font-size: 16px; margin: 0; }
                p { text-align: center; font-size: 11px; margin: 2px 0; }
                hr { border: none; border-top: 1px dashed black; margin: 10px 0; }
                strong { font-weight: bold; }
            </style>
        </head>
        <body onload="window.print(); window.close();">
            ${content}
        </body>
        </html>
    `);
    printWindow.document.close();
};

// --- UTILIDADES ---
window.closeModal = (id) => document.getElementById(id).style.display='none';
window.logout = () => { localStorage.removeItem('sidma_user'); location.reload(); };

window.borrarPedido = async (e, id) => {
    if(isProcessingAction) return;
    const res = await Swal.fire({title:'¿Borrar Pedido?', icon:'warning', showCancelButton:true});
    if(res.isConfirmed) {
        isProcessingAction = true;
        try { await fetch(`/api/pedidos/${id}`, {method:'DELETE'}); await loadData(); }
        finally { isProcessingAction = false; }
    }
};

window.borrarRuta = async (e, id) => {
    if(isProcessingAction) return;
    const res = await Swal.fire({title:'¿Anular Ruta?', icon:'warning', showCancelButton:true});
    if(res.isConfirmed) {
        isProcessingAction = true;
        try { await fetch(`/api/borrar_ruta/${id}`, {method:'DELETE'}); await loadData(); }
        finally { isProcessingAction = false; }
    }
};

window.addGastoRow = () => { 
    const d = document.createElement('div'); 
    d.className='grid-2 mini-grid'; 
    d.innerHTML = `<input type="text" class="g-desc" placeholder="Desc."><input type="number" class="g-val" placeholder="$" oninput="recalc()">`; 
    document.getElementById('gastosContainer').appendChild(d); 
};

window.openFin = (id) => {
    const r = rawDespachos.find(x => String(x.id) === String(id)); 
    document.getElementById('finId').value = id;
    const b = document.getElementById('checklistProds'); b.innerHTML = '';
    if(!r) return;
    r.detalles.forEach((c,ic) => {
        let h = `<div class="check-group" style="background:rgba(255,255,255,0.05); padding:8px; border-radius:5px; margin-bottom:10px;">
                    <div style="font-weight:bold; color:var(--orange); display:flex; justify-content:space-between;">
                        <span>${c.cliente}</span>
                        <span style="font-size:0.8rem; font-weight:normal;">Plan: ${fmtNum.format(c.productos.reduce((s,p)=>s+parseFloat(p.kg_plan),0))} Kg</span>
                    </div>`;
        c.productos.forEach((p,ip) => {
            h += `<div class="check-item-cond" style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                <div style="flex:2; font-size:0.9rem;">${p.producto}</div>
                <div style="flex:1; text-align:right; display:flex; align-items:center; gap:5px;">
                    <span style="font-size:0.7rem; color:#94a3b8;">${fmtNum.format(p.kg_plan)} ></span>
                    <input type="number" class="kg-ent-input" data-ic="${ic}" data-ip="${ip}" data-plan="${p.kg_plan}" value="${p.kg_plan}" oninput="recalc()" style="width:75px; text-align:right;">
                </div>
            </div>`;
        });
        b.innerHTML += h + '</div>';
    });
    document.getElementById('gastosContainer').innerHTML=''; 
    recalc();
    document.getElementById('modalFinalizar').style.display='flex';
};

window.recalc = () => { 
    const id = document.getElementById('finId').value;
    const r = rawDespachos.find(x => String(x.id) === String(id));
    if(!r) return;
    let kgEntregadosTotal = 0; 
    document.querySelectorAll('.kg-ent-input').forEach(inp => { kgEntregadosTotal += parseFloat(inp.value) || 0; }); 
    const tar = parseFloat(r.valor_tarifa)||0; 
    let base = (r.tipo_comision === 'variable') ? (kgEntregadosTotal * tar) : tar; 
    let g = 0; 
    document.querySelectorAll('.g-val').forEach(i => g += parseFloat(i.value)||0); 
    document.getElementById('finKg').innerText = fmtNum.format(kgEntregadosTotal); 
    document.getElementById('finTotal').innerText = fmtMoney.format(base+g); 
};

window.editRutaModal = (id) => {
    const r = rawDespachos.find(x => String(x.id) === String(id));
    if(!r) return;
    document.getElementById('editRutaId').value = id;
    const sP = document.getElementById('editRutaPlaca');
    sP.innerHTML = '<option value="">Seleccione...</option>';
    vehiculosList.forEach(v => { sP.innerHTML += `<option value="${v.placa}" ${v.placa === r.placa_vehiculo ? 'selected' : ''}>${v.placa}</option>`; });
    const sC = document.getElementById('editRutaCond');
    sC.innerHTML = '<option value="">Seleccione...</option>';
    conductoresList.forEach(c => { sC.innerHTML += `<option value="${c.nombre}" ${c.nombre === r.conductor_asignado ? 'selected' : ''}>${c.nombre}</option>`; });
    document.getElementById('editRutaTipo').value = r.tipo_comision || 'fija';
    document.getElementById('editRutaValor').value = r.valor_tarifa || 0;
    document.getElementById('modalEditRuta').style.display = 'flex';
};

window.submitEditRuta = async () => {
    if(isProcessingAction) return;
    isProcessingAction = true;
    const id = document.getElementById('editRutaId').value;
    const body = { 
        placa: document.getElementById('editRutaPlaca').value, 
        conductor: document.getElementById('editRutaCond').value, 
        tipo_comision: document.getElementById('editRutaTipo').value, 
        valor_tarifa: document.getElementById('editRutaValor').value 
    };
    try {
        const res = await fetch(`/api/editar_ruta/${id}`, { 
            method: 'PUT', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify(body) 
        });
        if(res.ok) { closeModal('modalEditRuta'); await loadData(); Swal.fire('Éxito','Ruta actualizada','success'); }
    } finally {
        isProcessingAction = false;
    }
};
