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
    if(iso.includes('-') && !iso.includes('T')) { 
        const [y,m,d]=iso.split('-'); 
        return `${d}/${m}/${y}`; 
    } 
    return new Date(iso).toLocaleDateString(LOCALE, { timeZone: TIMEZONE }); 
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
    try { const res = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user:u, pass:p})}); if(res.ok){ const d = await res.json(); localStorage.setItem('sidma_user', JSON.stringify(d.user)); location.reload(); } else { Swal.fire({title:'Error', text:'Credenciales incorrectas', icon:'error'}); } } catch { Swal.fire('Error', 'Sin conexión', 'error'); }
});

async function initApp(){
    document.getElementById('loginScreen').style.display='none'; document.getElementById('appLayout').style.display='block';
    document.getElementById('uName').textContent = user.nombre; document.getElementById('uRole').textContent = user.rol.toUpperCase();
    document.querySelectorAll('.role-section').forEach(el => el.style.display='none'); document.getElementById(`view-${user.rol}`).style.display='block';
    await loadData();
}

window.refreshData = async () => { await loadData(); Swal.fire({toast:true, position:'top-end', icon:'success', title:'Datos actualizados', timer:1500, showConfirmButton:false}); };

async function loadData(){
    const res = await fetch('/api/data'); const d = await res.json();
    vehiculosList = (d.vehiculos || []).map(v => ({...v, capacidad: parseFloat(v.capacidad) || 0}));
    conductoresList = d.conductores;
    rawDespachos = (d.despachos || []).map(processRow);
    rawPedidos = (d.pedidos || []).map(p => { let item = {...p}; try { item.productos = JSON.parse(item.productos_json); } catch { item.productos = []; } let t = 0; item.productos.forEach(x => t += parseFloat(x.kg_plan)||0); item.total_kg = t; return item; });
    
    extractUniqueData();
    renderViews();

    fetch('/api/historial')
        .then(r => r.json())
        .then(hist => {
            historyData = hist.map(processRow);
            extractUniqueData(); 
            console.log("Sistema actualizado: Memoria histórica cargada.");
        })
        .catch(e => console.error("Error cargando memoria histórica:", e));
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
    dlC.innerHTML = '';
    knownClients.forEach(c => { const opt = document.createElement('option'); opt.value = c; dlC.appendChild(opt); });

    const dlP = document.getElementById('listProductos');
    dlP.innerHTML = '';
    knownProducts.forEach(p => { const opt = document.createElement('option'); opt.value = p; dlP.appendChild(opt); });
}

function processRow(r) { let item = {}; for(let k in r) item[k.toLowerCase().trim()] = r[k]; try { item.detalles = JSON.parse(item.detalles_clientes_json); } catch { item.detalles = []; } try { item.gastos = JSON.parse(item.gastos_adicionales); } catch { item.gastos = []; } return item; }

function renderViews(){ if(user.rol === 'operador') renderOperador(); if(user.rol === 'admin') renderAdmin(); if(user.rol === 'conductor') renderConductor(); }

// ==========================================
// MÓDULO OPERADOR
// ==========================================
window.openPedidoModal = (id = null) => {
    const modal = document.getElementById('modalPedido'); const form = document.getElementById('formPedido'); const container = document.getElementById('prodContainer');
    form.reset(); container.innerHTML = ''; document.getElementById('pTotalKg').innerText = '0'; document.getElementById('editPedidoId').value = '';
    if(id) {
        const p = rawPedidos.find(x => x.id == id); if(!p) return;
        document.getElementById('modalPedidoTitle').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Pedido';
        document.getElementById('editPedidoId').value = id; document.getElementById('pFecha').value = p.fecha.split('T')[0]; document.getElementById('pHora').value = fmtTime(p.hora); document.getElementById('pCliente').value = p.cliente; document.getElementById('pOrden').value = p.orden; document.getElementById('pObs').value = p.observaciones || '';
        p.productos.forEach(prod => { addProdRow(container, prod.producto, prod.kg_plan); }); calcTotalPedido();
    } else {
        document.getElementById('modalPedidoTitle').innerHTML = '<i class="fa-solid fa-box-open"></i> Nuevo Pedido'; document.getElementById('pFecha').value = getBogotaDateISO(); addProdRow(container);
    }
    modal.style.display = 'flex';
};

window.addProdRow = (containerOrBtn, name='', kg='') => {
    let container = (containerOrBtn.id === 'prodContainer') ? containerOrBtn : document.getElementById('prodContainer');
    const row = document.createElement('div'); row.className = 'prod-row';
    row.innerHTML = `<input type="text" class="pr-name" placeholder="Producto" style="flex:2" value="${name}" list="listProductos" autocomplete="off" required><input type="number" class="pr-kg" placeholder="Kg" oninput="calcTotalPedido()" style="flex:1" value="${kg}" required><button type="button" onclick="this.parentElement.remove(); calcTotalPedido()" class="btn-del small">x</button>`;
    container.appendChild(row);
};

window.calcTotalPedido = () => { let t = 0; document.querySelectorAll('#prodContainer .pr-kg').forEach(i => t += parseFloat(i.value) || 0); document.getElementById('pTotalKg').innerText = fmtNum.format(t); };
document.getElementById('formPedido').addEventListener('submit', async(e) => {
    e.preventDefault(); const prods = []; document.querySelectorAll('#prodContainer .prod-row').forEach(pr => { const n = pr.querySelector('.pr-name').value; const k = pr.querySelector('.pr-kg').value; if(n && k) prods.push({ producto: n, kg_plan: k, kg_ent: k, estado: 'Pendiente' }); });
    if(prods.length === 0) return Swal.fire('Error', 'Agrega al menos un producto', 'warning');
    const body = { fecha: document.getElementById('pFecha').value, hora: document.getElementById('pHora').value, cliente: document.getElementById('pCliente').value, orden: document.getElementById('pOrden').value, observaciones: document.getElementById('pObs').value, productos: JSON.stringify(prods) };
    const editId = document.getElementById('editPedidoId').value; const url = editId ? `/api/pedidos/${editId}` : '/api/pedidos'; const method = editId ? 'PUT' : 'POST';
    const res = await fetch(url, {method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(res.ok) { Swal.fire('Guardado', editId ? 'Pedido actualizado' : 'Pedido creado', 'success'); document.getElementById('modalPedido').style.display = 'none'; loadData(); }
});

window.renderOperador = () => {
    const c = document.getElementById('listPedidosOperador'); c.innerHTML = '';
    rawPedidos.forEach(p => {
        let prodsList = p.productos.map(x => `<li>${x.producto} (${x.kg_plan}kg)</li>`).join('');
        c.innerHTML += `<div class="card item-card status-creada"><div style="display:flex; justify-content:space-between"><h4>${p.cliente}</h4><div><button onclick="openPedidoModal('${p.id}')" class="btn-sec small" style="color:var(--orange); border-color:var(--orange); margin-right:5px;"><i class="fa-solid fa-pen"></i></button><button onclick="borrarPedido('${p.id}')" class="btn-del small"><i class="fa-solid fa-trash"></i></button></div></div><p>Ord: ${p.orden || '--'} | ${fmtDate(p.fecha)} ${fmtTime(p.hora)}</p><ul style="font-size:0.8rem; padding-left:20px; color:#ccc;">${prodsList}</ul><div style="text-align:right; font-weight:bold; border-top:1px solid #444; padding-top:5px;">Total: ${fmtNum.format(p.total_kg)} Kg</div></div>`;
    });

    const activesOp = document.getElementById('listRutasActivasOperador');
    if(activesOp) {
        activesOp.innerHTML = '';
        const rutasActivas = rawDespachos.filter(x => x.estado === 'Asignada');
        if(rutasActivas.length === 0) { activesOp.innerHTML = '<p style="color:#777; font-style:italic; text-align:center;">No hay rutas asignadas actualmente.</p>'; }
        rutasActivas.forEach(r => {
            activesOp.innerHTML += `<div class="card item-card status-asignada"><div style="display:flex; justify-content:space-between; align-items:flex-start;"><h4>${r.nombre_ruta}</h4><span class="badge" style="background:var(--primary); font-size:0.7rem;">EN RUTA</span></div><p><i class="fa-solid fa-truck"></i> ${r.placa_vehiculo} | ${r.conductor_asignado}</p><p><strong>${fmtNum.format(r.total_kg_ruta)} Kg</strong> | ${r.detalles.length} Puntos de Entrega</p><div class="mt"><button onclick="openTicket('${r.id}')" class="btn-sec" style="width:100%">🖨️ Ver Planilla / Tiquete</button></div></div>`;
        });
    }
};
window.borrarPedido = async (id) => { if((await Swal.fire({title:'¿Borrar Pedido?', icon:'warning', showCancelButton:true})).isConfirmed) { await fetch(`/api/pedidos/${id}`, {method:'DELETE'}); loadData(); } };

// ==========================================
// MÓDULO ADMIN
// ==========================================
window.renderAdmin = () => {
    const actives = document.getElementById('listRutasActivas'); actives.innerHTML = '';
    rawDespachos.filter(x => x.estado === 'Asignada').forEach(r => {
        actives.innerHTML += `<div class="card item-card status-asignada"><div style="display:flex; justify-content:space-between"><h4>${r.nombre_ruta}</h4><button onclick="borrarRuta('${r.id}')" class="btn-del small"><i class="fa-solid fa-trash"></i></button></div><p>${r.placa_vehiculo} | ${r.conductor_asignado}</p><p>${fmtNum.format(r.total_kg_ruta)} Kg | ${r.detalles.length} Entregas</p><div class="grid-2 mt"><button onclick="openTicket('${r.id}')" class="btn-sec">🖨️ Ver</button><button onclick="editRutaModal('${r.id}')" class="btn-sec" style="color:var(--orange); border-color:var(--orange)">✏️ Editar</button></div></div>`;
    });
};

window.openCrearRutaModal = () => {
    document.getElementById('formRutaAdmin').reset();
    document.getElementById('rFecha').value = getBogotaDateISO();
    document.getElementById('rHora').value = new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
    document.getElementById('selCount').innerText = '0'; 
    document.getElementById('selKg').innerText = '0';
    
    document.getElementById('vehCapacidad').innerText = '---';
    document.getElementById('overloadWarning').style.display = 'none';
    document.getElementById('selKg').style.color = 'var(--green)';
    document.getElementById('vehCapacidad').style.color = 'inherit';

    const pool = document.getElementById('poolPedidosAdmin'); pool.innerHTML = '';
    if(rawPedidos.length === 0) pool.innerHTML = '<p style="color:#777; font-style:italic; text-align:center; margin-top:50px;">No hay pedidos pendientes.</p>';
    
    rawPedidos.forEach(p => {
        pool.innerHTML += `<div class="pedido-check-card"><label class="check-label"><input type="checkbox" class="chk-pedido" value="${p.id}" data-kg="${p.total_kg}" onchange="calcRutaAdmin()"><div><strong>${p.cliente}</strong> <small>(Ord: ${p.orden})</small><br><span style="font-size:0.8rem;">${fmtDate(p.fecha)} ${fmtTime(p.hora)} | <strong>${fmtNum.format(p.total_kg)} Kg</strong></span></div></label></div>`;
    });

    const sP = document.getElementById('rPlaca'); sP.innerHTML = '<option value="">Vehículo...</option>'; vehiculosList.forEach(v => sP.innerHTML += `<option value="${v.placa}">${v.placa}</option>`);
    const sC = document.getElementById('rCond'); sC.innerHTML = '<option value="">Conductor...</option>'; conductoresList.forEach(c => sC.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`);
    document.getElementById('modalCrearRuta').style.display = 'flex';
};

window.calcRutaAdmin = () => { 
    let count = 0; 
    let kg = 0; 
    document.querySelectorAll('.chk-pedido:checked').forEach(c => { count++; kg += parseFloat(c.dataset.kg); }); 
    
    document.getElementById('selCount').innerText = count; 
    const kgLabel = document.getElementById('selKg');
    kgLabel.innerText = fmtNum.format(kg); 

    const placa = document.getElementById('rPlaca').value;
    const vehiculo = vehiculosList.find(v => v.placa === placa);
    const capLabel = document.getElementById('vehCapacidad');
    const warning = document.getElementById('overloadWarning');

    if(vehiculo) {
        const capacidad = vehiculo.capacidad || 0;
        capLabel.innerText = fmtNum.format(capacidad);
        if(capacidad > 0 && kg > capacidad) {
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
    e.preventDefault(); const chks = document.querySelectorAll('.chk-pedido:checked'); if(chks.length === 0) return Swal.fire('Atención', 'Selecciona al menos un pedido para la ruta', 'warning');
    
    const pedidosFull = []; const detallesRuta = []; let totalKgRuta = 0;
    chks.forEach(chk => {
        const id = chk.value; const p = rawPedidos.find(x => String(x.id) === String(id));
        if(p) { pedidosFull.push(p); detallesRuta.push({ cliente: p.cliente, orden: p.orden, productos: p.productos }); totalKgRuta += parseFloat(p.total_kg); }
    });

    const body = { nombre_ruta: document.getElementById('rNombre').value, fecha: document.getElementById('rFecha').value, hora: document.getElementById('rHora').value, placa: document.getElementById('rPlaca').value, conductor: document.getElementById('rCond').value, tipo_comision: document.getElementById('rTipo').value, valor_tarifa: document.getElementById('rValor').value, observaciones: document.getElementById('rObs').value, total_kg: totalKgRuta, detalles: JSON.stringify(detallesRuta), pedidos_full: pedidosFull };
    Swal.fire({title:'Creando Ruta...', didOpen:()=>Swal.showLoading()}); 
    const res = await fetch('/api/crear_ruta', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(res.ok) { Swal.fire('Éxito', 'Ruta creada y asignada', 'success'); document.getElementById('modalCrearRuta').style.display = 'none'; loadData(); }
});

window.editRutaModal = (id) => { const r = rawDespachos.find(x => x.id == id); document.getElementById('editRutaId').value = id; const sP = document.getElementById('editRutaPlaca'); sP.innerHTML = '<option value="">Vehículo...</option>'; vehiculosList.forEach(v => sP.innerHTML += `<option value="${v.placa}" ${v.placa===r.placa_vehiculo?'selected':''}>${v.placa}</option>`); const sC = document.getElementById('editRutaCond'); sC.innerHTML = '<option value="">Conductor...</option>'; conductoresList.forEach(c => sC.innerHTML += `<option value="${c.nombre}" ${c.nombre===r.conductor_asignado?'selected':''}>${c.nombre}</option>`); document.getElementById('editRutaTipo').value = r.tipo_comision; document.getElementById('editRutaValor').value = r.valor_tarifa; document.getElementById('modalEditRuta').style.display = 'flex'; };
window.submitEditRuta = async() => { const id = document.getElementById('editRutaId').value; const body = { placa: document.getElementById('editRutaPlaca').value, conductor: document.getElementById('editRutaCond').value, tipo_comision: document.getElementById('editRutaTipo').value, valor_tarifa: document.getElementById('editRutaValor').value }; await fetch(`/api/editar_ruta/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); document.getElementById('modalEditRuta').style.display='none'; loadData(); };
window.borrarRuta = async (id) => { if((await Swal.fire({title:'¿Borrar Ruta?', text:'Los pedidos asociados volverán automáticamente a la lista de pendientes.', icon:'warning', showCancelButton:true})).isConfirmed){ await fetch(`/api/borrar_ruta/${id}`, {method:'DELETE'}); loadData(); Swal.fire('Ruta Borrada', 'Los pedidos han sido restaurados', 'success'); } };

// CONDUCTOR Y COMUNES
window.renderConductor = () => { const l = rawDespachos.filter(x => x.conductor_asignado === user.nombre && x.estado === 'Asignada'); const c = document.getElementById('listMisRutas'); c.innerHTML = ''; l.forEach(r => { let details = ''; r.detalles.forEach(d => details += `<li>${d.cliente} (Ord: ${d.orden || 'S/N'})</li>`); c.innerHTML += `<div class="card item-card status-asignada"><h3>${r.nombre_ruta}</h3><p><i class="fa-solid fa-truck"></i> ${r.placa_vehiculo} | <strong>${fmtNum.format(r.total_kg_ruta)} Kg</strong></p><ul style="font-size:0.8rem; color:#ccc; padding-left:20px">${details}</ul><div class="grid-2 mt"><button onclick="openTicket('${r.id}')" class="btn-sec">🖨️ Ver Tiquete</button><button onclick="openFin('${r.id}')" class="btn-primary">ENTREGAR / FINALIZAR</button></div></div>`; }); };
window.openFin = (id) => { const r = rawDespachos.find(x => x.id == id); document.getElementById('finId').value = id; const b = document.getElementById('checklistProds'); b.innerHTML = ''; r.detalles.forEach((c,ic) => { let h = `<div class="check-group"><div style="font-weight:bold; color:var(--orange); display:flex; justify-content:space-between;"><span>${c.cliente}</span> <span>Ord: ${c.orden||'--'}</span></div>`; c.productos.forEach((p,ip) => { h += `<div class="check-item-cond"><div style="flex:2">${p.producto}</div><div style="flex:1; text-align:right; font-size:0.8rem; color:#aaa;">Plan: ${fmtNum.format(p.kg_plan)}Kg</div><div style="flex:1; text-align:right;"><input type="number" class="kg-ent-input" data-ic="${ic}" data-ip="${ip}" data-plan="${p.kg_plan}" value="${p.kg_plan}" oninput="recalc()"></div></div>`; }); b.innerHTML += h + '</div>'; }); document.getElementById('gastosContainer').innerHTML=''; recalc(); document.getElementById('modalFinalizar').style.display='flex'; };

window.recalc = () => { 
    const r = rawDespachos.find(x => x.id == document.getElementById('finId').value); 
    let kgEntregadosTotal = 0; 
    document.querySelectorAll('.kg-ent-input').forEach(inp => { kgEntregadosTotal += parseFloat(inp.value) || 0; }); 
    const tar = parseFloat(r.valor_tarifa)||0; 
    let base = (r.tipo_comision === 'variable') ? (kgEntregadosTotal * tar) : tar; 
    let g = 0; 
    document.querySelectorAll('.g-val').forEach(i => g += parseFloat(i.value)||0); 
    document.getElementById('finKg').innerText = fmtNum.format(kgEntregadosTotal); 
    document.getElementById('finBase').innerText = fmtMoney.format(base); 
    document.getElementById('finTotal').innerText = fmtMoney.format(base+g); 
};

window.addGastoRow = () => { const d = document.createElement('div'); d.className='grid-2 mini-grid'; d.innerHTML = `<input type="text" class="g-desc" placeholder="Desc."><input type="number" class="g-val" placeholder="$" oninput="recalc()">`; document.getElementById('gastosContainer').appendChild(d); };

window.submitFinalizar = async() => { 
    const id = document.getElementById('finId').value; 
    const r = rawDespachos.find(x => x.id == id); 
    
    document.querySelectorAll('.kg-ent-input').forEach(inp => { 
        const ic = inp.dataset.ic; 
        const ip = inp.dataset.ip; 
        const real = parseFloat(inp.value) || 0; 
        const plan = parseFloat(inp.dataset.plan) || 0; 
        let status = 'Entregado'; 
        if(real === 0) status = 'Devuelto'; 
        else if(real < plan) status = 'Parcial'; 
        else if(real > plan) status = 'Excedente'; 
        r.detalles[ic].productos[ip].kg_ent = real; 
        r.detalles[ic].productos[ip].estado = status; 
    }); 

    const g = []; 
    document.querySelectorAll('#gastosContainer .grid-2').forEach(e => g.push({desc:e.querySelector('.g-desc').value, val:e.querySelector('.g-val').value})); 
    
    const totalPagarRaw = document.getElementById('finTotal').innerText.replace(/[$.]/g,'').replace(',','.'); 
    const totalKgRealRaw = document.getElementById('finKg').innerText.replace(/\./g,'').replace(',','.'); 
    
    const fd = new FormData(); 
    fd.append('detalles_actualizados', JSON.stringify(r.detalles)); 
    fd.append('gastos_json', JSON.stringify(g)); 
    fd.append('total_pagar', totalPagarRaw); 
    fd.append('total_kg_entregados_real', totalKgRealRaw); 
    
    if(document.getElementById('finFoto').files[0]) { fd.append('foto', document.getElementById('finFoto').files[0]); } 
    
    Swal.fire({title:'Finalizando Ruta', didOpen:()=>Swal.showLoading()}); 
    await fetch(`/api/finalizar/${id}`, {method:'PUT', body:fd}); 
    document.getElementById('modalFinalizar').style.display='none'; 
    loadData(); 
    Swal.fire('Ruta Finalizada','','success'); 
};

// HISTORIAL
window.openHistory = async () => { 
    Swal.fire({title:'Cargando...', didOpen:()=>Swal.showLoading()}); 
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
        
        curHistPage = 1; // Resetear a página 1
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
    const endIdx = startIdx + itemsPerPage;
    const pageData = filtrados.slice(startIdx, endIdx);

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
        const fechaMostrar = r.fecha_entrega ? fmtDate(r.fecha_entrega) : '<span style="color:#666;font-size:0.8em">S/F</span>';

        tbody.innerHTML += `<tr><td>${fechaMostrar}<br><small>${r.nombre_ruta}</small></td><td>${r.placa_vehiculo}</td><td>${r.conductor_asignado}</td><td>${fmtNum.format(kgReal)}</td><td>${fmtMoney.format(tarifa)}</td><td>${fmtMoney.format(comision)}</td><td style="display:flex; justify-content:center; gap:5px;">${btnFoto}<button onclick="openTicket('${r.id}')" class="btn-sec small">🖨️</button></td></tr>`; 
    }); 
    
    document.getElementById('hCount').textContent = filtrados.length; 
    document.getElementById('hKg').textContent = fmtNum.format(tKg); 
    document.getElementById('hComision').textContent = fmtMoney.format(tCom); 
};

window.changeHistoryPage = (delta) => { curHistPage += delta; renderHistoryTable(); };

window.exportHistoryCSV = () => { const dataToExport = window.currentHistoryFiltered || historyData; let csv = "\uFEFFFECHA;RUTA;PLACA;CONDUCTOR;KG REALES;TARIFA;COMISION;GASTOS ADICIONALES;PAGO TOTAL\n"; dataToExport.forEach(r => { const kgReal = parseFloat(r.total_kg_entregados_real) || 0; const tarifa = parseFloat(r.valor_tarifa)||0; const comision = (r.tipo_comision === 'variable') ? (kgReal * tarifa) : tarifa; let gastosStr = "Sin Gastos"; if(r.gastos && r.gastos.length > 0) { gastosStr = r.gastos.map(g => `${g.desc}: $${g.val}`).join(' | '); } csv += `${r.fecha_entrega.slice(0,10)};${r.nombre_ruta};${r.placa_vehiculo};${r.conductor_asignado};${kgReal};${tarifa};${comision};${gastosStr};${r.total_pagar_conductor}\n`; }); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'})); a.download = `Historial.csv`; a.click(); };

// --- ACTUALIZACIÓN DE TIQUETE CON DATOS FISCALES ---
window.generateTicketHTML = (r) => { 
    let listHTML = ''; 
    r.detalles.forEach(c => { 
        listHTML += `<div style="margin-top:8px; font-weight:bold; border-bottom:1px solid #000; font-size:12px; display:flex; justify-content:space-between;"><span>${c.cliente.toUpperCase()}</span> <span>Ord: ${c.orden||'--'}</span></div>`; 
        c.productos.forEach(p => { 
            const kgPlan = parseFloat(p.kg_plan) || 0; 
            const kgEnt = (p.kg_ent !== undefined) ? parseFloat(p.kg_ent) : kgPlan; 
            let statusTag = ''; 
            if(kgEnt === 0) statusTag = '<span class="t-tag-dev">[DEVUELTO]</span>'; 
            else if(kgEnt < kgPlan) statusTag = '<span class="t-tag-dev">[PARCIAL]</span>'; 
            const style = (kgEnt === 0) ? 't-devuelto' : ''; 
            listHTML += `<div class="t-row ${style}" style="font-size:11px; padding-left:5px"><span style="flex:2">- ${p.producto} ${statusTag}</span><span style="font-weight:bold">${fmtNum.format(kgEnt)} / ${fmtNum.format(kgPlan)} Kg</span></div>`; 
        }); 
    }); 
    
    let gastosHTML = ''; 
    let gastosTotal = 0; 
    if(r.gastos && r.gastos.length) { 
        gastosHTML = `<div class="t-divider"></div><div class="t-bold" style="margin-top:5px">GASTOS ADICIONALES:</div>`; 
        r.gastos.forEach(g => { 
            gastosHTML += `<div class="t-row"><span>${g.desc}</span><span>${fmtMoney.format(g.val)}</span></div>`; 
            gastosTotal += Number(g.val); 
        }); 
    } 
    
    const kgRealTotal = parseFloat(r.total_kg_entregados_real) || r.total_kg_ruta; 
    const tarifaVal = Number(r.valor_tarifa || 0); 
    let comisionVal = (r.tipo_comision === 'variable') ? (kgRealTotal * tarifaVal) : tarifaVal; 
    const totalPagar = r.estado === 'Finalizada' ? Number(r.total_pagar_conductor) : (comisionVal + gastosTotal); 
    const obsText = r.observaciones ? r.observaciones : ''; 
    const obsHTML = obsText ? `<div style="margin-top:15px; border:1px dashed #000; padding:5px; font-size:11px; background:#eee;"><strong>OBSERVACIONES:</strong><br>${obsText}</div>` : ''; 
    
    // CORRECCIÓN: Usamos hora_entrega que es donde el servidor mapea req.body.hora al crear ruta
    const fecha_salida = r.fecha_entrega || r.fecha || '';
    const h_salida = fmtTime(r.hora_entrega) || '--:--';
    
    return `
    <div class="t-header">
        <h2 style="margin:0; font-size:16px">Agrollanos Agricola Del Llano S.a.s.</h2>
        <p style="margin:2px 0">NIT: 830104572</p>
        <p style="font-weight:bold; font-size:14px; margin-top:5px">MANIFIESTO DE CARGA #${r.id.toString().slice(-4)}</p>
    </div>
    <div style="font-size:12px; margin-bottom:10px;">
        <div class="t-row"><span>Ruta:</span><strong>${r.nombre_ruta}</strong></div>
        <div class="t-row"><span>Salida:</span><span>${fmtDate(fecha_salida)} hora: ${h_salida}</span></div>
        <div class="t-row"><span>Estado:</span><span>${r.estado.toUpperCase()}</span></div>
        <div class="t-row"><span>Vehículo:</span><span>${r.placa_vehiculo||'---'}</span></div>
        <div class="t-row"><span>Conductor:</span><span>${r.conductor_asignado||'---'}</span></div>
    </div>
    <div class="t-divider"></div>
    <div style="text-align:center;font-weight:bold; margin:5px 0;">DETALLE DE CARGA</div>
    ${listHTML}
    <div class="t-divider"></div>
    <div class="t-row" style="font-size:13px; margin-top:5px;"><strong>TOTAL ENTREGADO:</strong><strong>${fmtNum.format(kgRealTotal)} Kg</strong></div>
    <div class="t-divider"></div>
    <div class="t-row"><span>Tarifa (${r.tipo_comision||'-'}):</span><span>${fmtMoney.format(tarifaVal)}</span></div>
    <div class="t-row"><span>Comisión Base:</span><span>${fmtMoney.format(comisionVal)}</span></div>
    ${gastosHTML}
    <div class="t-divider"></div>
    <div class="t-row" style="font-size:15px; margin-top:5px"><strong>TOTAL A PAGAR:</strong><strong>${fmtMoney.format(totalPagar)}</strong></div>
    ${obsHTML}
    <br><br>
    <div style="text-align:center; font-size:10px; color:#555">Generado por SIDMA LOG | ${new Date().toLocaleString(LOCALE, { timeZone: TIMEZONE })}</div>
    `; 
};

// Abre la vista previa del ticket y guarda la referencia
window.openTicket = (id) => { 
    const r = rawDespachos.find(x => x.id == id) || historyData.find(x => x.id == id); 
    currentTicketRoute = r; 
    const h = generateTicketHTML(r); 
    document.getElementById('ticketPreviewContent').innerHTML = h; 
    document.getElementById('printArea').innerHTML = h; 
    document.getElementById('modalTicket').style.display = 'flex'; 
};

// ACTUALIZADO: WhatsApp con emojis y detección robusta de fecha/hora (Cargue vs Pedido)
window.sendWhatsAppTicket = () => {
    if (!currentTicketRoute) return;

    // Aseguramos que detecte la fecha independientemente de la fuente (Despachos o Historial)
    const fecha = fmtDate(currentTicketRoute.fecha_entrega || currentTicketRoute.fecha);
    const horaCargue = fmtTime(currentTicketRoute.hora_entrega || '');

    // Formato de texto condensado con caracteres especiales de WhatsApp
    let msg = `*MANIFIESTO DE CARGA #${currentTicketRoute.id.toString().slice(-4)}*\n`;
    msg += `📅 *Salida:* ${fecha} hora: ${horaCargue}\n`;
    msg += `🛞 *Conductor:* ${currentTicketRoute.conductor_asignado}\n`;
    msg += `🚛 *Placa:* ${currentTicketRoute.placa_vehiculo}\n`;
    msg += `📍 *Ruta:* ${currentTicketRoute.nombre_ruta}\n\n`;
    
    msg += `📦 *DETALLE DE CARGA:*\n`;
    currentTicketRoute.detalles.forEach(c => {
        msg += `• *${c.cliente.toUpperCase()}* (📦 Ord: ${c.orden || 'S/N'})\n`;
        c.productos.forEach(p => {
            msg += `   - ${p.producto}: ${fmtNum.format(parseFloat(p.kg_plan))} Kg\n`;
        });
    });

    const totalKg = parseFloat(currentTicketRoute.total_kg_ruta) || 0;

    msg += `\n📦 *Total Carga:* ${fmtNum.format(totalKg)} Kg\n`;
    
    if (currentTicketRoute.observaciones) {
        msg += `\n📝 *OBS:* ${currentTicketRoute.observaciones}\n`;
    }

    // Abre el selector de contactos o grupos de WhatsApp
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
};

window.printNow = () => window.print(); window.closeModal = (id) => document.getElementById(id).style.display='none'; window.logout = () => { localStorage.removeItem('sidma_user'); location.reload(); }; window.verFoto = (url) => { Swal.fire({imageUrl: url, imageAlt: 'Evidencia', width: 600, showConfirmButton: false, background: '#1e293b', color: '#fff', showCloseButton:true}); };