let user = JSON.parse(localStorage.getItem('sidma_user')) || null;
let rawDespachos = [];
let rawPedidos = [];
let vehiculosList = [];
let conductoresList = [];
let historyData = [];

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

const fmtDate = (iso) => { 
    if(!iso) return ''; 
    // Manejo de strings simples YYYY-MM-DD
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

const getBogotaDateISO = () => { 
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: TIMEZONE})); 
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); 
};

const parseDateStr = (dateStr) => {
    if (!dateStr) return '0000-00-00';
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
    if (dateStr.includes('T')) return dateStr.split('T')[0];
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    }
    return dateStr;
};

document.addEventListener('DOMContentLoaded', () => { if(!user) document.getElementById('loginScreen').style.display = 'flex'; else initApp(); });

document.getElementById('loginForm').addEventListener('submit', async(e) => {
    e.preventDefault(); const u = document.getElementById('user').value; const p = document.getElementById('pass').value;
    try { 
        const res = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user:u, pass:p})}); 
        if(res.ok){ 
            const d = await res.json(); 
            localStorage.setItem('sidma_user', JSON.stringify(d.user)); 
            location.reload(); 
        } else { 
            Swal.fire({title:'Error', text:'Credenciales incorrectas', icon:'error'}); 
        } 
    } catch { 
        Swal.fire('Error', 'Sin conexión', 'error'); 
    }
});

async function initApp(){
    document.getElementById('loginScreen').style.display='none'; 
    document.getElementById('appLayout').style.display='block';
    document.getElementById('uName').textContent = user.nombre; 
    document.getElementById('uRole').textContent = user.rol.toUpperCase();
    document.querySelectorAll('.role-section').forEach(el => el.style.display='none'); 
    document.getElementById(`view-${user.rol}`).style.display='block';
    await loadData();
}

window.refreshData = async () => { await loadData(); Swal.fire({toast:true, position:'top-end', icon:'success', title:'Datos actualizados', timer:1500, showConfirmButton:false}); };

async function loadData(){
    const res = await fetch('/api/data'); 
    const d = await res.json();
    vehiculosList = (d.vehiculos || []).map(v => ({...v, capacidad: parseFloat(v.capacidad) || 0}));
    conductoresList = d.conductores;
    rawDespachos = (d.despachos || []).map(processRow);
    rawPedidos = (d.pedidos || []).map(p => { 
        let item = {...p}; 
        try { item.productos = JSON.parse(item.productos_json); } catch { item.productos = []; } 
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
    rawDespachos.forEach(r => {
        if(r.detalles) {
            r.detalles.forEach(d => {
                if(d.cliente) knownClients.add(d.cliente);
                if(d.productos) d.productos.forEach(prod => { if(prod.producto) knownProducts.add(prod.producto); });
            });
        }
    });
    historyData.forEach(r => {
        if(r.detalles) {
            r.detalles.forEach(d => {
                if(d.cliente) knownClients.add(d.cliente);
                if(d.productos) d.productos.forEach(prod => { if(prod.producto) knownProducts.add(prod.producto); });
            });
        }
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
    try { item.detalles = JSON.parse(item.detalles_clientes_json); } catch { item.detalles = []; } 
    try { item.gastos = JSON.parse(item.gastos_adicionales); } catch { item.gastos = []; } 
    return item; 
}

function renderViews(){ if(user.rol === 'operador') renderOperador(); if(user.rol === 'admin') renderAdmin(); if(user.rol === 'conductor') renderConductor(); }

// OPERADOR
window.openPedidoModal = (id = null) => {
    const modal = document.getElementById('modalPedido'); 
    const form = document.getElementById('formPedido'); 
    const container = document.getElementById('prodContainer');
    form.reset(); container.innerHTML = ''; 
    document.getElementById('pTotalKg').innerText = '0'; 
    document.getElementById('editPedidoId').value = '';
    if(id) {
        const p = rawPedidos.find(x => x.id == id); if(!p) return;
        document.getElementById('editPedidoId').value = id; 
        document.getElementById('pFecha').value = p.fecha.split('T')[0]; 
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
    const prods = []; 
    document.querySelectorAll('#prodContainer .prod-row').forEach(pr => { 
        const n = pr.querySelector('.pr-name').value; 
        const k = pr.querySelector('.pr-kg').value; 
        if(n && k) prods.push({ producto: n, kg_plan: k, kg_ent: k, estado: 'Pendiente' }); 
    });
    if(prods.length === 0) return Swal.fire('Error', 'Agrega al menos un producto', 'warning');
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
    const res = await fetch(url, {method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(res.ok) { 
        Swal.fire('Éxito', 'Pedido guardado', 'success'); 
        document.getElementById('modalPedido').style.display = 'none'; 
        loadData(); 
    }
});

function renderOperador() {
    const c = document.getElementById('listPedidosOperador'); c.innerHTML = '';
    rawPedidos.forEach(p => {
        let prodsList = p.productos.map(x => `<li>${x.producto} (${x.kg_plan}kg)</li>`).join('');
        c.innerHTML += `<div class="card item-card status-creada">
            <div style="display:flex; justify-content:space-between"><h4>${p.cliente}</h4>
            <div><button onclick="openPedidoModal('${p.id}')" class="btn-sec small"><i class="fa-solid fa-pen"></i></button>
            <button onclick="borrarPedido('${p.id}')" class="btn-del small"><i class="fa-solid fa-trash"></i></button></div></div>
            <p>Ord: ${p.orden || '--'} | ${fmtDate(p.fecha)} ${fmtTime(p.hora)}</p>
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
                <div class="mt"><button onclick="openTicket('${r.id}')" class="btn-sec" style="width:100%">🖨️ Ver Planilla / Tiquete</button></div>
            </div>`;
        });
    }
}

// LÓGICA DE BORRADO DE PEDIDOS (Operador y Admin)
window.borrarPedido = async (id) => { 
    const result = await Swal.fire({
        title: '¿Eliminar Pedido?',
        text: "Esta acción no se puede deshacer.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });
    
    if(result.isConfirmed) { 
        Swal.fire({title: 'Borrando...', didOpen: () => Swal.showLoading()});
        const res = await fetch(`/api/pedidos/${id}`, {method:'DELETE'});
        if(res.ok) {
            Swal.fire('Eliminado', 'El pedido ha sido borrado correctamente.', 'success');
            loadData();
        } else {
            Swal.fire('Error', 'No se pudo eliminar el pedido.', 'error');
        }
    } 
};

// ADMIN
function renderAdmin() {
    const actives = document.getElementById('listRutasActivas'); actives.innerHTML = '';
    rawDespachos.filter(x => x.estado === 'Asignada').forEach(r => {
        actives.innerHTML += `<div class="card item-card status-asignada">
            <div style="display:flex; justify-content:space-between"><h4>${r.nombre_ruta}</h4>
            <button onclick="borrarRuta('${r.id}')" class="btn-del small"><i class="fa-solid fa-trash"></i></button></div>
            <p>${r.placa_vehiculo} | ${r.conductor_asignado}</p>
            <div class="grid-2 mt"><button onclick="openTicket('${r.id}')" class="btn-sec">🖨️ Ver</button>
            <button onclick="editRutaModal('${r.id}')" class="btn-sec">✏️ Editar</button></div>
        </div>`;
    });
}

// LÓGICA DE EDICIÓN DE RUTAS (Admin)
window.editRutaModal = (id) => {
    const r = rawDespachos.find(x => x.id == id);
    if(!r) return;

    document.getElementById('editRutaId').value = id;
    
    const sP = document.getElementById('editRutaPlaca');
    sP.innerHTML = '<option value="">Vehículo...</option>';
    vehiculosList.forEach(v => {
        sP.innerHTML += `<option value="${v.placa}" ${v.placa === r.placa_vehiculo ? 'selected' : ''}>${v.placa}</option>`;
    });

    const sC = document.getElementById('editRutaCond');
    sC.innerHTML = '<option value="">Conductor...</option>';
    conductoresList.forEach(c => {
        sC.innerHTML += `<option value="${c.nombre}" ${c.nombre === r.conductor_asignado ? 'selected' : ''}>${c.nombre}</option>`;
    });

    document.getElementById('editRutaTipo').value = r.tipo_comision || 'fija';
    document.getElementById('editRutaValor').value = r.valor_tarifa || 0;
    
    document.getElementById('modalEditRuta').style.display = 'flex';
};

window.submitEditRuta = async () => {
    const id = document.getElementById('editRutaId').value;
    const body = {
        placa: document.getElementById('editRutaPlaca').value,
        conductor: document.getElementById('editRutaCond').value,
        tipo_comision: document.getElementById('editRutaTipo').value,
        valor_tarifa: document.getElementById('editRutaValor').value
    };

    if(!body.placa || !body.conductor) {
        return Swal.fire('Atención', 'Selecciona vehículo y conductor', 'warning');
    }

    Swal.fire({title: 'Actualizando ruta...', didOpen: () => Swal.showLoading()});
    const res = await fetch(`/api/editar_ruta/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });

    if(res.ok) {
        Swal.fire('Éxito', 'Ruta actualizada correctamente', 'success');
        closeModal('modalEditRuta');
        loadData();
    } else {
        Swal.fire('Error', 'No se pudo actualizar la ruta', 'error');
    }
};

window.borrarRuta = async (id) => {
    const result = await Swal.fire({
        title: '¿Anular esta Ruta?',
        text: "Los pedidos volverán a estar pendientes para ser asignados a otra ruta.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Sí, anular ruta',
        cancelButtonText: 'Cancelar'
    });

    if(result.isConfirmed) {
        Swal.fire({title: 'Anulando ruta...', didOpen: () => Swal.showLoading()});
        const res = await fetch(`/api/borrar_ruta/${id}`, {method:'DELETE'});
        if(res.ok) {
            Swal.fire('Ruta Anulada', 'La ruta fue eliminada y los pedidos han sido restaurados.', 'success');
            loadData();
        } else {
            Swal.fire('Error', 'No se pudo anular la ruta.', 'error');
        }
    }
};

window.openCrearRutaModal = () => {
    document.getElementById('formRutaAdmin').reset();
    document.getElementById('rFecha').value = getBogotaDateISO();
    document.getElementById('rHora').value = new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
    
    document.getElementById('vehCapacidad').innerText = '---';
    document.getElementById('overloadWarning').style.display = 'none';
    document.getElementById('selKg').style.color = 'var(--green)';

    const pool = document.getElementById('poolPedidosAdmin'); pool.innerHTML = '';
    rawPedidos.forEach(p => {
        pool.innerHTML += `<div class="pedido-check-card">
            <label class="check-label">
                <input type="checkbox" class="chk-pedido" value="${p.id}" data-kg="${p.total_kg}" onchange="calcRutaAdmin()">
                <div>
                    <strong>${p.cliente}</strong> (Ord: ${p.orden})<br>
                    <span>${fmtDate(p.fecha)} | <strong>${fmtNum.format(p.total_kg)} Kg</strong></span>
                </div>
            </label>
            <button onclick="window.splitPedidoModal('${p.id}')" class="btn-sec small" title="Fraccionar Peso" style="margin-left:auto; border-color:var(--orange); color:var(--orange);">✂️</button>
        </div>`;
    });
    const sP = document.getElementById('rPlaca'); sP.innerHTML = '<option value="">Vehículo...</option>'; vehiculosList.forEach(v => sP.innerHTML += `<option value="${v.placa}">${v.placa}</option>`);
    const sC = document.getElementById('rCond'); sC.innerHTML = '<option value="">Conductor...</option>'; conductoresList.forEach(c => sC.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`);
    document.getElementById('modalCrearRuta').style.display = 'flex';
};

// ACTUALIZACIÓN: FRACCIONAMIENTO POR PESO (KG) CON CREACIÓN DE PEDIDO B Y ACTUALIZACIÓN DE A
window.splitPedidoModal = async (id) => {
    const p = rawPedidos.find(x => String(x.id) === String(id));
    if (!p) return;

    let html = `<p style="font-size:0.9rem; margin-bottom:10px;">Indica cuántos Kg de cada producto quieres mover al <strong>segundo vehículo</strong>:</p><div style="text-align:left; max-height:350px; overflow-y:auto; border:1px solid #444; border-radius:5px; padding:10px;">`;
    p.productos.forEach((item, index) => {
        html += `<div style="padding:10px 0; border-bottom:1px solid #333;">
            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                <span style="font-weight:bold;">${item.producto}</span>
                <span style="color:var(--primary);">${fmtNum.format(item.kg_plan)} Kg Total</span>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <label style="font-size:0.8rem; color:#aaa;">Mover:</label>
                <input type="number" class="split-weight-input" data-index="${index}" data-max="${item.kg_plan}" 
                       value="0" min="0" max="${item.kg_plan}" 
                       style="flex:1; background:#0f172a; border:1px solid #444; color:white; padding:5px; border-radius:4px;">
                <span style="font-size:0.8rem; color:#aaa;">Kg</span>
            </div>
        </div>`;
    });
    html += `</div>`;

    const result = await Swal.fire({
        title: 'Fraccionar Pedido',
        html: html,
        showCancelButton: true,
        confirmButtonText: '✂️ CORTAR Y ACTUALIZAR VENTA',
        cancelButtonText: 'Cancelar',
        background: '#1e293b',
        color: '#f8fafc',
        preConfirm: () => {
            const inputs = document.querySelectorAll('.split-weight-input');
            const data = [];
            let totalMoved = 0;
            let totalRemaining = 0;

            inputs.forEach(input => {
                const moved = parseFloat(input.value) || 0;
                const max = parseFloat(input.dataset.max);
                const idx = parseInt(input.dataset.index);
                
                if (moved > max) {
                    Swal.showValidationMessage(`No puedes mover más de ${max} Kg en ${p.productos[idx].producto}`);
                }
                
                data.push({ index: idx, moved, remaining: max - moved });
                totalMoved += moved;
                totalRemaining += (max - moved);
            });

            if (totalMoved <= 0) {
                Swal.showValidationMessage('Debes mover al menos un poco de peso al segundo vehículo.');
            }
            if (totalRemaining <= 0) {
                Swal.showValidationMessage('No puedes mover el 100% de la carga. Para eso usa el pedido completo.');
            }

            return data;
        }
    });

    if (result.isConfirmed && result.value) {
        const splitData = result.value;
        const productosParteA = [];
        const productosParteB = [];

        splitData.forEach(item => {
            const originalProd = p.productos[item.index];
            
            // Si queda algo en el pedido original (Parte A)
            if (item.remaining > 0) {
                productosParteA.push({
                    ...originalProd,
                    kg_plan: item.remaining,
                    kg_ent: item.remaining,
                    estado: 'Pendiente'
                });
            }

            // Si se movió algo al nuevo pedido (Parte B)
            if (item.moved > 0) {
                productosParteB.push({
                    ...originalProd,
                    kg_plan: item.moved,
                    kg_ent: item.moved,
                    estado: 'Pendiente'
                });
            }
        });

        Swal.fire({title: 'Procesando fraccionamiento...', didOpen: () => Swal.showLoading()});

        try {
            // 1. Crear el nuevo pedido con la fracción (Parte B)
            const bodyNew = { 
                fecha: p.fecha.split('T')[0], 
                hora: p.hora, 
                cliente: p.cliente, 
                orden: p.orden + "-B", 
                observaciones: (p.observaciones || "") + " (Fracción de carga)", 
                productos: JSON.stringify(productosParteB) 
            };
            const resB = await fetch('/api/pedidos', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(bodyNew)});

            // 2. Actualizar el pedido original con el remanente (Parte A)
            const bodyUpdate = { 
                fecha: p.fecha.split('T')[0], 
                hora: p.hora, 
                cliente: p.cliente, 
                orden: p.orden + "-A", 
                observaciones: p.observaciones || "", 
                productos: JSON.stringify(productosParteA) 
            };
            const resA = await fetch(`/api/pedidos/${p.id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(bodyUpdate)});

            if (resB.ok && resA.ok) {
                await loadData();
                Swal.fire('Éxito', 'Pedido fraccionado. Se han generado dos partes (A y B) para asignar.', 'success');
                window.openCrearRutaModal(); // Recargar modal para mostrar los pedidos "picados"
            } else {
                throw new Error("Error en la comunicación con el servidor");
            }
        } catch (e) {
            Swal.fire('Error', 'Ocurrió un error al fraccionar la carga: ' + e.message, 'error');
        }
    }
};

window.calcRutaAdmin = () => {
    let count = 0, kg = 0; 
    let combinedObs = "";
    document.querySelectorAll('.chk-pedido:checked').forEach(c => { 
        count++; 
        kg += parseFloat(c.dataset.kg); 
        const p = rawPedidos.find(x => String(x.id) === String(c.value));
        if (p && p.observaciones) {
            combinedObs += `${p.cliente}: ${p.observaciones} | `;
        }
    }); 
    
    document.getElementById('selCount').innerText = count; 
    const kgLabel = document.getElementById('selKg');
    kgLabel.innerText = fmtNum.format(kg);
    document.getElementById('rObs').value = combinedObs;

    const placa = document.getElementById('rPlaca').value;
    const vehiculo = vehiculosList.find(v => v.placa === placa);
    const capLabel = document.getElementById('vehCapacidad');
    const warning = document.getElementById('overloadWarning');

    if (vehiculo) {
        const capacidad = vehiculo.capacidad || 0;
        capLabel.innerText = fmtNum.format(capacidad);
        if (capacidad > 0 && kg > capacidad) {
            kgLabel.style.color = '#ef4444';
            capLabel.style.color = '#ef4444';
            warning.style.display = 'block';
        } else {
            kgLabel.style.color = 'var(--green)';
            capLabel.style.color = 'inherit';
            warning.style.display = 'none';
        }
    } else {
        capLabel.innerText = '---';
        warning.style.display = 'none';
        kgLabel.style.color = 'var(--green)';
    }
};

document.getElementById('formRutaAdmin').addEventListener('submit', async(e) => {
    e.preventDefault(); 
    const chks = document.querySelectorAll('.chk-pedido:checked'); 
    if(chks.length === 0) return Swal.fire('Error', 'Selecciona pedidos', 'warning');
    const detallesRuta = []; 
    let totalKgRuta = 0;
    const pedidosFull = [];
    chks.forEach(chk => {
        const p = rawPedidos.find(x => String(x.id) === String(chk.value));
        if(p) { 
            pedidosFull.push(p); 
            // NUEVO: Guardamos la fecha del pedido original en el detalle
            detallesRuta.push({ cliente: p.cliente, orden: p.orden, productos: p.productos, fecha_original: p.fecha }); 
            totalKgRuta += parseFloat(p.total_kg); 
        }
    });
    const body = { 
        nombre_ruta: document.getElementById('rNombre').value, 
        fecha: document.getElementById('rFecha').value, 
        hora: document.getElementById('rHora').value, 
        placa: document.getElementById('rPlaca').value, 
        conductor: document.getElementById('rCond').value, 
        tipo_comision: document.getElementById('rTipo').value, 
        valor_tarifa: document.getElementById('rValor').value, 
        observaciones: document.getElementById('rObs').value, 
        total_kg: totalKgRuta, 
        detalles: JSON.stringify(detallesRuta), 
        pedidos_full: pedidosFull 
    };
    Swal.fire({title:'Creando Ruta...', didOpen:()=>Swal.showLoading()}); 
    const res = await fetch('/api/crear_ruta', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(res.ok) { Swal.fire('Éxito', 'Ruta asignada', 'success'); closeModal('modalCrearRuta'); loadData(); }
});

// CONDUCTOR
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

window.openFin = (id) => {
    const r = rawDespachos.find(x => x.id == id); document.getElementById('finId').value = id;
    const b = document.getElementById('checklistProds'); b.innerHTML = '';
    r.detalles.forEach((c,ic) => {
        let h = `<div class="check-group"><div style="font-weight:bold; color:var(--orange);">${c.cliente}</div>`;
        c.productos.forEach((p,ip) => {
            h += `<div class="check-item-cond">
                <div style="flex:2">${p.producto}</div>
                <div style="flex:1; text-align:right;"><input type="number" class="kg-ent-input" data-ic="${ic}" data-ip="${ip}" data-plan="${p.kg_plan}" value="${p.kg_plan}" oninput="recalc()"></div>
            </div>`;
        });
        b.innerHTML += h + '</div>';
    });
    document.getElementById('gastosContainer').innerHTML=''; recalc();
    document.getElementById('modalFinalizar').style.display='flex';
};

window.recalc = () => { 
    const id = document.getElementById('finId').value;
    const r = rawDespachos.find(x => x.id == id) || historyData.find(x => x.id == id);
    let kgEntregadosTotal = 0; 
    document.querySelectorAll('.kg-ent-input').forEach(inp => { kgEntregadosTotal += parseFloat(inp.value) || 0; }); 
    const tar = parseFloat(r.valor_tarifa)||0; 
    let base = (r.tipo_comision === 'variable') ? (kgEntregadosTotal * tar) : tar; 
    let g = 0; document.querySelectorAll('.g-val').forEach(i => g += parseFloat(i.value)||0); 
    document.getElementById('finKg').innerText = fmtNum.format(kgEntregadosTotal); 
    document.getElementById('finTotal').innerText = fmtMoney.format(base+g); 
};

window.addGastoRow = () => { const d = document.createElement('div'); d.className='grid-2 mini-grid'; d.innerHTML = `<input type="text" class="g-desc" placeholder="Desc."><input type="number" class="g-val" placeholder="$" oninput="recalc()">`; document.getElementById('gastosContainer').appendChild(d); };

window.submitFinalizar = async() => {
    const id = document.getElementById('finId').value; const r = rawDespachos.find(x => x.id == id);
    document.querySelectorAll('.kg-ent-input').forEach(inp => {
        const ic = inp.dataset.ic; const ip = inp.dataset.ip;
        r.detalles[ic].productos[ip].kg_ent = parseFloat(inp.value) || 0;
        r.detalles[ic].productos[ip].estado = (parseFloat(inp.value) >= parseFloat(inp.dataset.plan)) ? 'Entregado' : 'Incompleto';
    });
    const g = []; document.querySelectorAll('#gastosContainer .grid-2').forEach(e => g.push({desc:e.querySelector('.g-desc').value, val:e.querySelector('.g-val').value}));
    const fd = new FormData();
    fd.append('detalles_actualizados', JSON.stringify(r.detalles)); fd.append('gastos_json', JSON.stringify(g));
    fd.append('total_pagar', document.getElementById('finTotal').innerText.replace(/[$.]/g,'').replace(',','.'));
    fd.append('total_kg_entregados_real', document.getElementById('finKg').innerText.replace(/\./g,'').replace(',','.'));
    if(document.getElementById('finFoto').files[0]) fd.append('foto', document.getElementById('finFoto').files[0]);
    await fetch(`/api/finalizar/${id}`, {method:'PUT', body:fd}); closeModal('modalFinalizar'); loadData(); Swal.fire('Ruta Finalizada','','success');
};

// --- MÓDULO HISTORIAL (RESTAURADO) ---
window.openHistory = async () => { 
    Swal.fire({title:'Cargando historial...', didOpen:()=>Swal.showLoading()}); 
    try { 
        const res = await fetch('/api/historial'); 
        const archivadas = await res.json(); 
        historyData = archivadas.map(processRow); 
        extractUniqueData();

        const isoStart = getBogotaDateISO().substring(0, 8) + '01'; 
        document.getElementById('histIni').value = isoStart; 
        document.getElementById('histFin').value = getBogotaDateISO(); 
        
        const sp = document.getElementById('histPlaca'); sp.innerHTML = '<option value="">Todas</option>'; vehiculosList.forEach(v => sp.innerHTML += `<option value="${v.placa}">${v.placa}</option>`); 
        const sc = document.getElementById('histCond'); sc.innerHTML = '<option value="">Todos</option>'; conductoresList.forEach(c => sc.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`); 
        
        if(user.rol === 'conductor') { sc.value = user.nombre; sc.disabled = true; } else { sc.disabled = false; } 
        
        curHistPage = 1; 
        renderHistoryTable(); 
        Swal.close(); 
        document.getElementById('modalHistory').style.display = 'flex'; 
    } catch(e) { Swal.fire('Error', e.message, 'error'); } 
};

window.renderHistoryTable = () => { 
    const ini = document.getElementById('histIni').value; 
    const fin = document.getElementById('histFin').value; 
    const pFilter = document.getElementById('histPlaca').value; 
    const cFilter = (user.rol === 'conductor') ? user.nombre : document.getElementById('histCond').value; 
    
    const filtrados = historyData.filter(r => { 
        const d = parseDateStr(r.fecha_entrega || r.fecha || '');
        const inDate = (!ini || d >= ini) && (!fin || d <= fin); 
        const inPlaca = !pFilter || r.placa_vehiculo === pFilter; 
        const inCond = !cFilter || r.conductor_asignado === cFilter; 
        return inDate && inPlaca && inCond; 
    }); 
    currentHistoryFiltered = filtrados;

    const totalItems = filtrados.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (curHistPage > totalPages) curHistPage = totalPages;
    if (curHistPage < 1) curHistPage = 1;

    const startIdx = (curHistPage - 1) * itemsPerPage;
    const pageData = filtrados.slice(startIdx, startIdx + itemsPerPage);

    document.getElementById('pageIndicator').innerText = `Página ${curHistPage} de ${totalPages}`;
    document.getElementById('btnPrevHist').disabled = (curHistPage === 1);
    document.getElementById('btnNextHist').disabled = (curHistPage === totalPages);
    
    let tKg = 0, tCom = 0; 
    filtrados.forEach(r => {
        const kg = parseFloat(r.total_kg_entregados_real) || 0; 
        const tar = parseFloat(r.valor_tarifa)||0; 
        const com = (r.tipo_comision === 'variable') ? (kg * tar) : tar; 
        tKg += kg; tCom += com;
    });

    const tbody = document.querySelector('#tableHistory tbody'); tbody.innerHTML = ''; 
    pageData.forEach(r => { 
        const kgReal = parseFloat(r.total_kg_entregados_real) || 0; 
        const tarifa = parseFloat(r.valor_tarifa)||0; 
        const comision = (r.tipo_comision === 'variable') ? (kgReal * tarifa) : tarifa; 
        const btnFoto = r.evidencia_foto ? `<button onclick="verFoto('${r.evidencia_foto}')" class="btn-sec small" title="Ver Foto">📷</button>` : ''; 
        const fechaMostrar = r.fecha_entrega ? fmtDate(r.fecha_entrega) : fmtDate(r.fecha);

        tbody.innerHTML += `<tr>
            <td>${fechaMostrar}<br><small>${r.nombre_ruta}</small></td>
            <td>${r.placa_vehiculo}</td>
            <td>${r.conductor_asignado}</td>
            <td>${fmtNum.format(kgReal)}</td>
            <td>${fmtMoney.format(tarifa)}</td>
            <td>${fmtMoney.format(comision)}</td>
            <td style="display:flex; justify-content:center; gap:5px;">
                ${btnFoto}
                <button onclick="openTicket('${r.id}')" class="btn-sec small" title="Ver Tiquete">🖨️</button>
            </td>
        </tr>`; 
    }); 
    
    document.getElementById('hCount').textContent = filtrados.length; 
    document.getElementById('hKg').textContent = fmtNum.format(tKg); 
    document.getElementById('hComision').textContent = fmtMoney.format(tCom); 
};

window.changeHistoryPage = (delta) => { curHistPage += delta; renderHistoryTable(); };

// ACTUALIZACIÓN: EXPORTACIÓN DETALLADA DE GASTOS
window.exportHistoryCSV = () => { 
    const dataToExport = window.currentHistoryFiltered || historyData; 
    // Cabecera con nuevas columnas de gastos
    let csv = "\uFEFFFECHA;RUTA;PLACA;CONDUCTOR;KG REALES;TARIFA;COMISION;VALOR GASTOS;DESCRIPCIÓN GASTOS;PAGO TOTAL\n"; 
    
    dataToExport.forEach(r => { 
        const kgReal = parseFloat(r.total_kg_entregados_real) || 0; 
        const tarifa = parseFloat(r.valor_tarifa)||0; 
        const comision = (r.tipo_comision === 'variable') ? (kgReal * tarifa) : tarifa; 
        
        // Calcular suma de montos y concatenar descripciones
        let totalValGastos = 0;
        let descs = "";
        (r.gastos || []).forEach(g => {
            totalValGastos += parseFloat(g.val) || 0;
            if (g.desc) descs += `${g.desc}: ${g.val} | `;
        });
        
        // Limpiar la descripción de caracteres que rompan el CSV (punto y coma)
        const descsClean = descs.replace(/;/g, ",").slice(0, -3); // Elimina el último " | "
        
        csv += `${r.fecha_entrega || r.fecha};${r.nombre_ruta};${r.placa_vehiculo};${r.conductor_asignado};${kgReal};${tarifa};${comision};${totalValGastos};"${descsClean}";${r.total_pagar_conductor}\n`; 
    }); 
    
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'})); 
    a.download = `Reporte_Detallado_Agrollanos.csv`; 
    a.click(); 
};

window.verFoto = (url) => { 
    Swal.fire({imageUrl: url, imageAlt: 'Evidencia', width: 600, showConfirmButton: false, background: '#1e293b', color: '#fff', showCloseButton:true}); 
};

// VISTA PREVIA Y WHATSAPP (CORRECCIÓN DE FECHA DE SALIDA Y HORA DE CARGUE)
window.generateTicketHTML = (r) => {
    let listHTML = '';
    r.detalles.forEach(c => {
        // Mostramos la fecha original del pedido si existe
        const fPedido = c.fecha_original ? `<div style="font-size:10px; color:#555">F. Pedido: ${fmtDate(c.fecha_original)}</div>` : '';
        listHTML += `
        <div style="margin-top:8px; border-bottom:1px solid #000; padding-bottom:2px;">
            <div style="font-weight:bold; font-size:12px; display:flex; justify-content:space-between;">
                <span>${c.cliente.toUpperCase()}</span>
                <span>Ord: ${c.orden||'--'}</span>
            </div>
            ${fPedido}
        </div>`;
        
        c.productos.forEach(p => {
            const kgEnt = (p.kg_ent !== undefined) ? parseFloat(p.kg_ent) : parseFloat(p.kg_plan);
            listHTML += `<div class="t-row" style="font-size:11px; padding-left:5px"><span>- ${p.producto}</span><span>${fmtNum.format(kgEnt)} Kg</span></div>`;
        });
    });
    
    // Priorizamos la hora guardada en la creación de la ruta (r.hora)
    const h_cargue = fmtTime(r.hora) || fmtTime(r.hora_entrega) || '--:--';
    // Priorizamos la fecha de la ruta (r.fecha)
    const f_salida = fmtDate(r.fecha) || fmtDate(r.fecha_entrega) || '--/--/----';
    
    return `
    <div class="t-header">
        <h2 style="margin:0; font-size:16px">AGROLLANOS</h2>
        <p style="font-weight:bold; font-size:14px; margin-top:5px">MANIFIESTO DE CARGA #${r.id.toString().slice(-4)}</p>
    </div>
    <div style="font-size:12px; margin-bottom:10px;">
        <div class="t-row"><span>Ruta:</span><strong>${r.nombre_ruta}</strong></div>
        <div class="t-row"><span>F. Salida:</span><span>${f_salida}</span></div>
        <div class="t-row"><span>H. Cargue:</span><span>${h_cargue}</span></div>
        <div class="t-row"><span>Vehículo:</span><span>${r.placa_vehiculo||'---'}</span></div>
        <div class="t-row"><span>Conductor:</span><span>${r.conductor_asignado||'---'}</span></div>
    </div>
    <div class="t-divider"></div>
    <div style="text-align:center;font-weight:bold; margin:5px 0;">DETALLE DE CARGA</div>
    ${listHTML}
    <div class="t-divider"></div>
    <div class="t-row" style="font-size:13px; margin-top:5px;"><strong>TOTAL ENTREGADO:</strong><strong>${fmtNum.format(parseFloat(r.total_kg_entregados_real) || r.total_kg_ruta)} Kg</strong></div>
    ${r.observaciones ? `<div style="margin-top:10px; font-size:11px; border:1px dashed #000; padding:4px;"><strong>OBS:</strong> ${r.observaciones}</div>` : ''}
    <br><br><div style="text-align:center; font-size:10px; color:#555">SidmaLog Agrollanos | ${new Date().toLocaleString(LOCALE, { timeZone: TIMEZONE })}</div>`;
};

window.openTicket = (id) => {
    const r = rawDespachos.find(x => x.id == id) || historyData.find(x => x.id == id);
    currentTicketRoute = r;
    const h = generateTicketHTML(r);
    document.getElementById('ticketPreviewContent').innerHTML = h;
    document.getElementById('printArea').innerHTML = h;
    document.getElementById('modalTicket').style.display = 'flex';
};

window.sendWhatsAppTicket = () => {
    if (!currentTicketRoute) return;
    const r = currentTicketRoute;
    const fechaRuta = fmtDate(r.fecha) || fmtDate(r.fecha_entrega) || '--/--/----';
    const horaCargue = fmtTime(r.hora) || fmtTime(r.hora_entrega) || '--:--';
    
    let msg = `*MANIFIESTO DE CARGA #${r.id.toString().slice(-4)}*\n`;
    msg += `📅 *F. Salida:* ${fechaRuta}\n`;
    msg += `⏰ *H. Cargue:* ${horaCargue}\n`;
    msg += `🛞 *Conductor:* ${r.conductor_asignado}\n`;
    msg += `🚛 *Placa:* ${r.placa_vehiculo}\n`;
    msg += `📍 *Ruta:* ${r.nombre_ruta}\n\n`;
    
    msg += `📦 *DETALLE DE CARGA:*\n`;
    r.detalles.forEach(c => {
        const fechaOriginal = c.fecha_original ? ` (${fmtDate(c.fecha_original)})` : '';
        msg += `• *${c.cliente.toUpperCase()}* - Ord: ${c.orden || 'S/N'}${fechaOriginal}\n`;
        c.productos.forEach(p => {
            msg += `   - ${p.producto}: ${fmtNum.format(parseFloat(p.kg_plan))} Kg\n`;
        });
    });

    const totalKg = parseFloat(r.total_kg_entregados_real) || r.total_kg_ruta;
    msg += `\n📦 *Total Carga:* ${fmtNum.format(totalKg)} Kg\n`;
    
    if (r.observaciones) msg += `\n📝 *OBS:* ${r.observaciones}\n`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
};

window.printNow = () => window.print();
window.closeModal = (id) => document.getElementById(id).style.display='none';
window.logout = () => { localStorage.removeItem('sidma_user'); location.reload(); };
