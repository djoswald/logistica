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

// --- INICIO APP ---
document.addEventListener('DOMContentLoaded', () => { if(!user) document.getElementById('loginScreen').style.display = 'flex'; else initApp(); });

document.getElementById('loginForm').addEventListener('submit', async(e) => {
    e.preventDefault(); 
    const btn = e.target.querySelector('button');
    if(btn.disabled) return;
    btn.disabled = true;

    const u = document.getElementById('user').value; const p = document.getElementById('pass').value;
    try { 
        const res = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user:u, pass:p})}); 
        if(res.ok){ 
            const d = await res.json(); 
            localStorage.setItem('sidma_user', JSON.stringify(d.user)); 
            location.reload(); 
        } else { 
            Swal.fire({title:'Error', text:'Credenciales incorrectas', icon:'error'}); 
            btn.disabled = false;
        } 
    } catch { 
        Swal.fire('Error', 'Sin conexión', 'error'); 
        btn.disabled = false;
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
    vehiculosList = (d.vehiculos || []).map(v => {
        let item = processRow(v);
        item.capacidad = parseFloat(item.capacidad) || 0;
        return item;
    });
    conductoresList = (d.conductores || []).map(processRow);
    rawDespachos = (d.despachos || []).map(processRow);
    rawPedidos = (d.pedidos || []).map(p => { 
        let item = processRow(p); 
        try { 
            const jsonStr = item.productos_json || item.productos;
            item.productos = JSON.parse(jsonStr); 
        } catch { item.productos = []; } 
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
    if (item.detalles_clientes_json) {
        try { item.detalles = JSON.parse(item.detalles_clientes_json); } catch { item.detalles = []; } 
    }
    if (item.gastos_adicionales) {
        try { item.gastos = JSON.parse(item.gastos_adicionales); } catch { item.gastos = []; } 
    }
    return item; 
}

function renderViews(){ 
    const counter = document.getElementById('orderCounter');
    if(counter) {
        const count = rawPedidos.length;
        counter.textContent = count;
        counter.style.display = count > 0 ? 'flex' : 'none';
    }

    if(user.rol === 'operador') renderOperador(); 
    if(user.rol === 'admin') renderAdmin(); 
    if(user.rol === 'conductor') renderConductor(); 
}

// --- OPERADOR ---
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
    const btn = e.target.querySelector('button[type="submit"]');
    if(btn.disabled) return;
    btn.disabled = true;

    const prods = []; 
    document.querySelectorAll('#prodContainer .prod-row').forEach(pr => { 
        const n = pr.querySelector('.pr-name').value; 
        const k = pr.querySelector('.pr-kg').value; 
        if(n && k) prods.push({ producto: n, kg_plan: k, kg_ent: k, estado: 'Pendiente' }); 
    });
    if(prods.length === 0) {
        btn.disabled = false;
        return Swal.fire('Error', 'Agrega al menos un producto', 'warning');
    }
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

    Swal.fire({title: 'Guardando...', didOpen: () => Swal.showLoading()});

    const res = await fetch(url, {method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(res.ok) { 
        Swal.fire('Éxito', 'Pedido guardado', 'success'); 
        document.getElementById('modalPedido').style.display = 'none'; 
        loadData(); 
    } else {
        Swal.fire('Error', 'No se pudo guardar', 'error');
    }
    btn.disabled = false;
});

function renderOperador() {
    const c = document.getElementById('listPedidosOperador'); c.innerHTML = '';
    rawPedidos.forEach(p => {
        let prodsList = p.productos.map(x => `<li>${x.producto} (${x.kg_plan}kg)</li>`).join('');
        c.innerHTML += `<div class="card item-card status-creada">
            <div style="display:flex; justify-content:space-between"><h4>${p.cliente}</h4>
            <div><button onclick="openPedidoModal('${p.id}')" class="btn-sec small"><i class="fa-solid fa-pen"></i></button>
            <button onclick="borrarPedido(event, '${p.id}')" class="btn-del small"><i class="fa-solid fa-trash"></i></button></div></div>
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

window.borrarPedido = async (e, id) => { 
    const btn = e.currentTarget;
    if(btn.disabled) return;

    const result = await Swal.fire({ title: '¿Eliminar Pedido?', icon: 'warning', showCancelButton: true });
    if(result.isConfirmed) { 
        btn.disabled = true;
        Swal.fire({title: 'Borrando...', didOpen: () => Swal.showLoading()});
        const res = await fetch(`/api/pedidos/${id}`, {method:'DELETE'});
        if(res.ok) { loadData(); Swal.fire('Borrado','','success'); }
        btn.disabled = false;
    } 
};

// --- ADMIN ---
function renderAdmin() {
    // === NUEVO: Lógica del Contador de Pedidos Pendientes (ALERTA ROJA) ===
    const msgBox = document.getElementById('msgPedidosPendientes');
    const lblCount = document.getElementById('lblCountPedidos');
    if(msgBox && lblCount) {
        if(rawPedidos.length > 0) {
            msgBox.style.display = 'block';
            lblCount.textContent = rawPedidos.length;
        } else {
            msgBox.style.display = 'none';
        }
    }
    // ======================================================================

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

window.editRutaModal = (id) => {
    const r = rawDespachos.find(x => String(x.id) === String(id));
    if(!r) return;
    document.getElementById('editRutaId').value = id;
    const sP = document.getElementById('editRutaPlaca');
    sP.innerHTML = '<option value="">Vehículo...</option>';
    vehiculosList.forEach(v => { sP.innerHTML += `<option value="${v.placa}" ${v.placa === r.placa_vehiculo ? 'selected' : ''}>${v.placa}</option>`; });
    const sC = document.getElementById('editRutaCond');
    sC.innerHTML = '<option value="">Conductor...</option>';
    conductoresList.forEach(c => { sC.innerHTML += `<option value="${c.nombre}" ${c.nombre === r.conductor_asignado ? 'selected' : ''}>${c.nombre}</option>`; });
    document.getElementById('editRutaTipo').value = r.tipo_comision || 'fija';
    document.getElementById('editRutaValor').value = r.valor_tarifa || 0;
    document.getElementById('modalEditRuta').style.display = 'flex';
};

window.submitEditRuta = async () => {
    const btn = document.querySelector('#modalEditRuta .btn-primary');
    if(btn.disabled) return;
    btn.disabled = true;

    const id = document.getElementById('editRutaId').value;
    const body = { placa: document.getElementById('editRutaPlaca').value, conductor: document.getElementById('editRutaCond').value, tipo_comision: document.getElementById('editRutaTipo').value, valor_tarifa: document.getElementById('editRutaValor').value };
    
    Swal.fire({title: 'Actualizando...', didOpen: () => Swal.showLoading()});
    const res = await fetch(`/api/editar_ruta/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
    if(res.ok) { closeModal('modalEditRuta'); loadData(); Swal.fire('Éxito','','success'); }
    btn.disabled = false;
};

window.borrarRuta = async (e, id) => {
    const btn = e.currentTarget;
    if(btn.disabled) return;

    const result = await Swal.fire({ title: '¿Anular Ruta?', icon: 'warning', showCancelButton: true });
    if(result.isConfirmed) {
        btn.disabled = true;
        Swal.fire({title: 'Anulando...', didOpen: () => Swal.showLoading()});
        const res = await fetch(`/api/borrar_ruta/${id}`, {method:'DELETE'});
        if(res.ok) { loadData(); Swal.fire('Ruta Anulada','','success'); }
        btn.disabled = false;
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
            <button onclick="window.splitPedidoModal('${p.id}')" class="btn-sec small" title="Fraccionar Peso">✂️</button>
        </div>`;
    });
    const sP = document.getElementById('rPlaca'); sP.innerHTML = '<option value="">Vehículo...</option>'; vehiculosList.forEach(v => sP.innerHTML += `<option value="${v.placa}">${v.placa}</option>`);
    const sC = document.getElementById('rCond'); sC.innerHTML = '<option value="">Conductor...</option>'; conductoresList.forEach(c => sC.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`);
    document.getElementById('modalCrearRuta').style.display = 'flex';
};

window.calcRutaAdmin = () => {
    let count = 0, kg = 0; let combinedObs = "";
    document.querySelectorAll('.chk-pedido:checked').forEach(c => { 
        count++; kg += parseFloat(c.dataset.kg); 
        const p = rawPedidos.find(x => String(x.id) === String(c.value));
        if (p && p.observaciones) combinedObs += `${p.cliente}: ${p.observaciones} | `;
    }); 
    document.getElementById('selCount').innerText = count; 
    const kgLabel = document.getElementById('selKg'); kgLabel.innerText = fmtNum.format(kg);
    document.getElementById('rObs').value = combinedObs;

    const placa = document.getElementById('rPlaca').value;
    const vehiculo = vehiculosList.find(v => v.placa === placa);
    const capLabel = document.getElementById('vehCapacidad');
    const warning = document.getElementById('overloadWarning');

    if (vehiculo) {
        const capacidad = vehiculo.capacidad || 0;
        capLabel.innerText = fmtNum.format(capacidad);
        if (capacidad > 0 && kg > capacidad) { kgLabel.style.color = '#ef4444'; capLabel.style.color = '#ef4444'; warning.style.display = 'block'; }
        else { kgLabel.style.color = 'var(--green)'; capLabel.style.color = 'inherit'; warning.style.display = 'none'; }
    } else { capLabel.innerText = '---'; warning.style.display = 'none'; }
};

document.getElementById('formRutaAdmin').addEventListener('submit', async(e) => {
    e.preventDefault(); 
    const btn = e.target.querySelector('button[type="submit"]');
    if(btn.disabled) return;
    btn.disabled = true;

    const chks = document.querySelectorAll('.chk-pedido:checked'); 
    if(chks.length === 0) { btn.disabled = false; return Swal.fire('Error', 'Selecciona pedidos', 'warning'); }
    
    const detallesRuta = []; let totalKgRuta = 0; const pedidosFull = [];
    chks.forEach(chk => {
        const p = rawPedidos.find(x => String(x.id) === String(chk.value));
        if(p) { 
            pedidosFull.push(p); 
            detallesRuta.push({ 
                cliente: p.cliente, 
                orden: p.orden, 
                productos: p.productos, 
                fecha_original: p.fecha,
                hora_original: p.hora 
            }); 
            totalKgRuta += parseFloat(p.total_kg); 
        }
    });
    const body = { nombre_ruta: document.getElementById('rNombre').value, fecha: document.getElementById('rFecha').value, hora: document.getElementById('rHora').value, placa: document.getElementById('rPlaca').value, conductor: document.getElementById('rCond').value, tipo_comision: document.getElementById('rTipo').value, valor_tarifa: document.getElementById('rValor').value, observaciones: document.getElementById('rObs').value, total_kg: totalKgRuta, detalles: JSON.stringify(detallesRuta), pedidos_full: pedidosFull };
    
    Swal.fire({title:'Creando Ruta...', didOpen:()=>Swal.showLoading()}); 
    const res = await fetch('/api/crear_ruta', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(res.ok) { closeModal('modalCrearRuta'); loadData(); Swal.fire('Éxito','','success'); }
    btn.disabled = false;
});

// --- FRACCIONAMIENTO ---
window.splitPedidoModal = async (id) => {
    const p = rawPedidos.find(x => String(x.id) === String(id));
    if (!p) return;

    let html = `<p style="font-size:0.9rem; margin-bottom:10px;">Indica cuántos Kg de cada producto quieres mover al <strong>segundo vehículo</strong>:</p><div style="text-align:left; max-height:350px; overflow-y:auto; border:1px solid #444; border-radius:5px; padding:10px;">`;
    p.productos.forEach((item, index) => {
        html += `
            <div style="padding:10px 0; border-bottom:1px solid #333;">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="font-weight:bold;">${item.producto}</span>
                    <span style="color:var(--primary);">${fmtNum.format(item.kg_plan)} Kg Total</span>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="font-size:0.8rem; color:#aaa;">Mover:</label>
                    <input type="number" class="split-weight-input" data-index="${index}" data-max="${item.kg_plan}" value="0" min="0" max="${item.kg_plan}" style="flex:1; background:#0f172a; border:1px solid #444; color:white; padding:5px; border-radius:4px;">
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
        showLoaderOnConfirm: true,
        preConfirm: () => {
            const splitData = [];
            let totalMoved = 0;
            document.querySelectorAll('.split-weight-input').forEach(input => {
                const moved = parseFloat(input.value) || 0;
                const index = parseInt(input.dataset.index);
                const maxKg = parseFloat(input.dataset.max);
                if (moved > maxKg) {
                    Swal.showValidationMessage(`El valor no puede superar ${maxKg} Kg`);
                    return false;
                }
                if (moved > 0) totalMoved += moved;
                splitData.push({ index, moved, remaining: maxKg - moved });
            });
            if (totalMoved <= 0) {
                Swal.showValidationMessage('Debes mover al menos 1 Kg en algún producto');
                return false;
            }
            return splitData;
        }
    });

    if (result.isConfirmed) {
        Swal.fire({title: 'Procesando...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
        const splitData = result.value;
        const productosParteA = [];
        const productosParteB = [];

        splitData.forEach(item => {
            const originalProd = p.productos[item.index];
            if (item.remaining > 0) {
                productosParteA.push({ ...originalProd, kg_plan: item.remaining, kg_ent: item.remaining });
            }
            if (item.moved > 0) {
                productosParteB.push({ ...originalProd, kg_plan: item.moved, kg_ent: item.moved });
            }
        });

        try {
            const resB = await fetch('/api/pedidos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...p, id: null, orden: p.orden + "-B", productos: JSON.stringify(productosParteB) })
            });
            const resA = await fetch(`/api/pedidos/${p.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...p, orden: p.orden + "-A", productos: JSON.stringify(productosParteA) })
            });

            if (resB.ok && resA.ok) {
                await loadData();
                Swal.fire('Éxito', 'Pedido fraccionado', 'success');
                window.openCrearRutaModal();
            } else {
                Swal.fire('Error', 'No se pudo fraccionar', 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de conexión', 'error');
        }
    }
};

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

window.openFin = (id) => {
    const r = rawDespachos.find(x => String(x.id) === String(id)); document.getElementById('finId').value = id;
    const b = document.getElementById('checklistProds'); b.innerHTML = '';
    if(!r) return;
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
    const r = rawDespachos.find(x => String(x.id) === String(id)) || historyData.find(x => String(x.id) === String(id));
    if(!r) return;
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
    const btn = document.querySelector('#modalFinalizar .btn-primary:last-child');
    if(btn.disabled) return;
    btn.disabled = true;

    const id = document.getElementById('finId').value; const r = rawDespachos.find(x => String(x.id) === String(id));
    if(!r) { btn.disabled = false; return; }
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
    
    Swal.fire({title: 'Guardando...', didOpen: () => Swal.showLoading()});
    
    try {
        const res = await fetch(`/api/finalizar/${id}`, {method:'PUT', body:fd});
        if(res.ok) { closeModal('modalFinalizar'); await loadData(); Swal.fire('Éxito','','success'); }
        else { Swal.fire('Error','','error'); btn.disabled = false; }
    } catch(e) {
        Swal.fire('Error de conexión','','error');
        btn.disabled = false;
    }
};

// --- HISTORIAL ---
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
    const ini = document.getElementById('histIni').value; const fin = document.getElementById('histFin').value; const pFilter = document.getElementById('histPlaca').value; const cFilter = (user.rol === 'conductor') ? user.nombre : document.getElementById('histCond').value; 
    const filtrados = historyData.filter(r => { const d = parseDateStr(r.fecha_entrega || r.fecha || ''); const inDate = (!ini || d >= ini) && (!fin || d <= fin); const inPlaca = !pFilter || r.placa_vehiculo === pFilter; const inCond = !cFilter || r.conductor_asignado === cFilter; return inDate && inPlaca && inCond; }); 
    currentHistoryFiltered = filtrados;
    const totalItems = filtrados.length; const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (curHistPage > totalPages) curHistPage = totalPages; if (curHistPage < 1) curHistPage = 1;
    const startIdx = (curHistPage - 1) * itemsPerPage; const pageData = filtrados.slice(startIdx, startIdx + itemsPerPage);
    document.getElementById('pageIndicator').innerText = `Página ${curHistPage} de ${totalPages}`;
    document.getElementById('btnPrevHist').disabled = (curHistPage === 1); document.getElementById('btnNextHist').disabled = (curHistPage === totalPages);
    let tKg = 0, tCom = 0; filtrados.forEach(r => { const kg = parseFloat(r.total_kg_entregados_real) || 0; const tar = parseFloat(r.valor_tarifa)||0; const com = (r.tipo_comision === 'variable') ? (kg * tar) : tar; tKg += kg; tCom += com; });
    
    // Corregimos la estructura visual de la tabla y sus encabezados
    const thead = document.querySelector('#tableHistory thead');
    if (thead) {
        thead.innerHTML = `<tr><th>Fecha/Ruta</th><th>Placa</th><th>Conductor</th><th>Kg Ent.</th><th>Comisión</th><th>Gastos</th><th>Total</th><th>Acc.</th></tr>`;
    }

    const tbody = document.querySelector('#tableHistory tbody'); tbody.innerHTML = ''; 
    pageData.forEach(r => { 
        const kgReal = parseFloat(r.total_kg_entregados_real) || 0; 
        const tarifa = parseFloat(r.valor_tarifa)||0; 
        const comision = (r.tipo_comision === 'variable') ? (kgReal * tarifa) : tarifa; 
        
        let sumGastos = 0;
        if (r.gastos && Array.isArray(r.gastos)) {
            r.gastos.forEach(g => sumGastos += parseFloat(g.val) || 0);
        }
        
        const totalFinal = comision + sumGastos;
        const btnFoto = r.evidencia_foto ? `<button onclick="verFoto('${r.evidencia_foto}')" class="btn-sec small">📷</button>` : ''; 
        
        tbody.innerHTML += `<tr>
            <td>${fmtDate(r.fecha_entrega || r.fecha)}<br><small>${r.nombre_ruta}</small></td>
            <td>${r.placa_vehiculo}</td>
            <td>${r.conductor_asignado}</td>
            <td>${fmtNum.format(kgReal)}</td>
            <td>${fmtMoney.format(comision)}</td>
            <td>${fmtMoney.format(sumGastos)}</td>
            <td><strong>${fmtMoney.format(totalFinal)}</strong></td>
            <td style="display:flex; justify-content:center; gap:5px;">${btnFoto}<button onclick="openTicket('${r.id}')" class="btn-sec small">🖨️</button></td>
        </tr>`; 
    }); 
    document.getElementById('hCount').textContent = filtrados.length; document.getElementById('hKg').textContent = fmtNum.format(tKg); document.getElementById('hComision').textContent = fmtMoney.format(tCom); 
};

window.changeHistoryPage = (delta) => { curHistPage += delta; renderHistoryTable(); };
window.verFoto = (url) => { Swal.fire({imageUrl: url, width: 600, showConfirmButton: false, showCloseButton:true}); };

// --- TIQUETES ---
window.openTicket = (id) => {
    const r = rawDespachos.find(x => String(x.id) === String(id)) || historyData.find(x => String(x.id) === String(id));
    if(!r) return;
    currentTicketRoute = r;
    const h = generateTicketHTML(r);
    document.getElementById('ticketPreviewContent').innerHTML = h;
    document.getElementById('printArea').innerHTML = h;
    document.getElementById('modalTicket').style.display = 'flex';
};

window.generateTicketHTML = (r) => {
    let listHTML = '';
    r.detalles.forEach(c => {
        // Obtenemos fecha y hora formateadas del pedido individual
        const fPed = c.fecha_original ? fmtDate(c.fecha_original) : '';
        const hPed = c.hora_original ? fmtTime(c.hora_original) : '';
        const infoPedido = (fPed || hPed) ? `<span style="font-size:9px; font-weight:normal; color:#555;">${fPed} ${hPed}</span>` : '';

        listHTML += `<div style="margin-top:8px; border-bottom:1px solid #000; padding-bottom:2px;">
            <div style="font-weight:bold; font-size:12px; display:flex; justify-content:space-between; align-items:center;">
                <span>${c.cliente.toUpperCase()}</span>
                ${infoPedido}
                <span>Ord: ${c.orden||'--'}</span>
            </div>
        </div>`;
        c.productos.forEach(p => { const kg = (p.kg_ent !== undefined) ? p.kg_ent : p.kg_plan; listHTML += `<div class="t-row" style="font-size:11px; padding-left:5px"><span>- ${p.producto}</span><span>${fmtNum.format(kg)} Kg</span></div>`; });
    });
    const fRuta = fmtDate(r.fecha) || fmtDate(r.fecha_entrega) || '--/--/----';
    const hCargue = fmtTime(r.hora) || fmtTime(r.hora_entrega) || '--:--';
    
    // Cálculos de costos para el tiquete
    const kgReal = parseFloat(r.total_kg_entregados_real) || r.total_kg_ruta || 0;
    const tarifa = parseFloat(r.valor_tarifa) || 0;
    const comision = (r.tipo_comision === 'variable') ? (kgReal * tarifa) : tarifa;
    let sumGastos = 0;
    if (r.gastos && Array.isArray(r.gastos)) {
        r.gastos.forEach(g => sumGastos += parseFloat(g.val) || 0);
    }
    const totalFinal = comision + sumGastos;

    let obsHTML = r.observaciones ? `<div class="t-divider"></div><div style="font-size:11px; margin-top:5px;"><strong>OBS:</strong> ${r.observaciones}</div>` : '';
    
    // Lógica para mostrar costos SOLO si el estatus es finalizado
    let footerCostos = '';
    if (r.estado === 'finalizada' || r.fecha_entrega) {
        footerCostos = `
            <div class="t-divider"></div>
            <div class="t-row" style="font-size:11px;"><span>Comisión:</span><span>${fmtMoney.format(comision)}</span></div>
            <div class="t-row" style="font-size:11px;"><span>Gastos:</span><span>${fmtMoney.format(sumGastos)}</span></div>
            <div class="t-row" style="font-size:13px; margin-top:5px;"><strong>TOTAL A PAGAR:</strong><strong>${fmtMoney.format(totalFinal)}</strong></div>
        `;
    }

    return `<div class="t-header"><h2 style="margin:0; font-size:16px">AGROLLANOS</h2><p style="font-weight:bold; font-size:14px; margin-top:5px">Carga Id#${r.id.toString().slice(-4)}</p></div>
    <div style="font-size:12px;">
        <div class="t-row"><span>Ruta:</span><strong>${r.nombre_ruta}</strong></div>
        <div class="t-row"><span>Fecha:</span><span>${fRuta}</span></div>
        <div class="t-row"><span>Hora:</span><span>${hCargue}</span></div>
        <div class="t-row"><span>Conductor:</span><span>${r.conductor_asignado}</span></div>
        <div class="t-row"><span>Vehiculo:</span><span>${r.placa_vehiculo}</span></div>
    </div>
    <div class="t-divider"></div>
    ${listHTML}
    <div class="t-divider"></div>
    <div class="t-row" style="font-size:13px; margin-top:5px;"><strong>TOTAL CARGA:</strong><strong>${fmtNum.format(kgReal)} Kg</strong></div>
    ${footerCostos}
    ${obsHTML}`;
};

window.sendWhatsAppTicket = () => {
    if (!currentTicketRoute) return;
    const r = currentTicketRoute;
    const fRuta = fmtDate(r.fecha) || fmtDate(r.fecha_entrega) || '--/--/----';
    const hCargue = fmtTime(r.hora) || fmtTime(r.hora_entrega) || '--:--';
    
    // Cálculos básicos de carga
    const kgReal = parseFloat(r.total_kg_entregados_real) || r.total_kg_ruta || 0;

    let msg = `*SidmaLog - Orden Id#${r.id.toString().slice(-4)}*\n📅 *Fecha:* ${fRuta}\n⏰ *Hora:* ${hCargue}\n🛞 *Conductor:* ${r.conductor_asignado}\n🚛 *Vehiculo:* ${r.placa_vehiculo}\n📍 *Ruta:* ${r.nombre_ruta}\n\n*DETALLE DE CARGA:*\n`;
    
    r.detalles.forEach(c => { 
        // No incluimos la información de fecha_original ni hora_original para el mensaje de WhatsApp por solicitud
        msg += `• *${c.cliente.toUpperCase()}* - Ord: ${c.orden || 'S/N'}\n`; 
        c.productos.forEach(p => { 
            const kg = (p.kg_ent !== undefined) ? p.kg_ent : p.kg_plan; 
            msg += `   - ${p.producto}: ${fmtNum.format(parseFloat(kg))} Kg\n`; 
        }); 
    });

    msg += `\n📦 *Total Carga:* ${fmtNum.format(kgReal)} Kg`;
    
    if (r.observaciones) msg += `\n\n📝 *OBS:* ${r.observaciones}`;
    
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
};

// --- EXPORTAR CSV ---
window.exportHistoryCSV = () => {
    if (!currentHistoryFiltered.length) return Swal.fire('Error', 'No hay datos para exportar', 'warning');
    
    // Encabezados con codificación Latin (usamos BOM para Excel)
    let csv = "\uFEFFID;Fecha;Ruta;Placa;Conductor;Kg Real;Tarifa;Comisión;Gastos;Total a Pagar;Observaciones\n";
    
    currentHistoryFiltered.forEach(r => {
        const kgReal = parseFloat(r.total_kg_entregados_real) || 0;
        const tarifa = parseFloat(r.valor_tarifa) || 0;
        const comision = (r.tipo_comision === 'variable') ? (kgReal * tarifa) : tarifa;
        
        let sumGastos = 0;
        if (r.gastos && Array.isArray(r.gastos)) {
            r.gastos.forEach(g => sumGastos += parseFloat(g.val) || 0);
        }
        
        const totalConductor = comision + sumGastos;
        
        const row = [
            r.id,
            fmtDate(r.fecha_entrega || r.fecha),
            r.nombre_ruta,
            r.placa_vehiculo,
            r.conductor_asignado,
            fmtNum.format(kgReal).replace(/\./g, ''), 
            fmtNum.format(tarifa).replace(/\./g, ''),
            fmtNum.format(comision).replace(/\./g, ''),
            fmtNum.format(sumGastos).replace(/\./g, ''),
            fmtNum.format(totalConductor).replace(/\./g, ''),
            (r.observaciones || "").replace(/;/g, ",").replace(/\n/g, " ") 
        ];
        csv += row.join(";") + "\n";
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `historial_rutas_agrollanos_${getBogotaDateISO()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.printNow = () => window.print();
window.closeModal = (id) => document.getElementById(id).style.display='none';
window.logout = () => { localStorage.removeItem('sidma_user'); location.reload(); };

const parseDateStr = (d) => { if(!d) return ''; if(d.includes('T')) return d.split('T')[0]; return d; };