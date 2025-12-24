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

window.borrarPedido = async (id) => { if((await Swal.fire({title:'¿Borrar Pedido?', icon:'warning', showCancelButton:true})).isConfirmed) { await fetch(`/api/pedidos/${id}`, {method:'DELETE'}); loadData(); } };

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

window.openCrearRutaModal = () => {
    document.getElementById('formRutaAdmin').reset();
    document.getElementById('rFecha').value = getBogotaDateISO();
    document.getElementById('rHora').value = new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
    const pool = document.getElementById('poolPedidosAdmin'); pool.innerHTML = '';
    rawPedidos.forEach(p => {
        pool.innerHTML += `<div class="pedido-check-card"><label class="check-label">
            <input type="checkbox" class="chk-pedido" value="${p.id}" data-kg="${p.total_kg}" onchange="calcRutaAdmin()">
            <div><strong>${p.cliente}</strong> (Ord: ${p.orden})<br><span>${fmtDate(p.fecha)} | <strong>${fmtNum.format(p.total_kg)} Kg</strong></span></div>
        </label></div>`;
    });
    const sP = document.getElementById('rPlaca'); sP.innerHTML = '<option value="">Vehículo...</option>'; vehiculosList.forEach(v => sP.innerHTML += `<option value="${v.placa}">${v.placa}</option>`);
    const sC = document.getElementById('rCond'); sC.innerHTML = '<option value="">Conductor...</option>'; conductoresList.forEach(c => sC.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`);
    document.getElementById('modalCrearRuta').style.display = 'flex';
};

// ACTUALIZACIÓN: Ahora concatena observaciones de pedidos seleccionados
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
    document.getElementById('selKg').innerText = fmtNum.format(kg);
    document.getElementById('rObs').value = combinedObs; // Muestra la construcción de obs en el modal
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
            detallesRuta.push({ cliente: p.cliente, orden: p.orden, productos: p.productos }); 
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

// VISTA PREVIA Y WHATSAPP
window.generateTicketHTML = (r) => {
    let listHTML = '';
    r.detalles.forEach(c => {
        listHTML += `<div style="margin-top:8px; font-weight:bold; border-bottom:1px solid #000; font-size:12px; display:flex; justify-content:space-between;"><span>${c.cliente.toUpperCase()}</span><span>Ord: ${c.orden||'--'}</span></div>`;
        c.productos.forEach(p => {
            const kgEnt = (p.kg_ent !== undefined) ? parseFloat(p.kg_ent) : parseFloat(p.kg_plan);
            listHTML += `<div class="t-row" style="font-size:11px; padding-left:5px"><span>- ${p.producto}</span><span>${fmtNum.format(kgEnt)} Kg</span></div>`;
        });
    });
    const h_cargue = fmtTime(r.hora_entrega) || '--:--';
    
    return `
    <div class="t-header">
        <h2 style="margin:0; font-size:16px">AGROLLANOS</h2>
        <p style="font-weight:bold; font-size:14px; margin-top:5px">MANIFIESTO DE CARGA #${r.id.toString().slice(-4)}</p>
    </div>
    <div style="font-size:12px; margin-bottom:10px;">
        <div class="t-row"><span>Ruta:</span><strong>${r.nombre_ruta}</strong></div>
        <div class="t-row"><span>Salida:</span><span>${fmtDate(r.fecha)} hora: ${h_cargue}</span></div>
        <div class="t-row"><span>Estado:</span><span>${r.estado.toUpperCase()}</span></div>
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
    const fecha = fmtDate(r.fecha);
    const hora = fmtTime(r.hora_entrega) || '--:--';
    
    let msg = `*MANIFIESTO DE CARGA #${r.id.toString().slice(-4)}*\n`;
    msg += `📅 *Salida:* ${fecha} hora: ${hora}\n`;
    msg += `🛞 *${r.conductor_asignado}*\n`;
    msg += `🚛 *${r.placa_vehiculo}*\n`;
    msg += `📍 *Ruta:* ${r.nombre_ruta}\n\n`;
    
    msg += `📦 *DETALLE DE CARGA:*\n`;
    r.detalles.forEach(c => {
        msg += `• *${c.cliente.toUpperCase()}* (Ord: ${c.orden || 'S/N'})\n`;
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
