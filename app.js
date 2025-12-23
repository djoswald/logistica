let user = JSON.parse(localStorage.getItem('sidma_user')) || null;
let rawData = [];
let vehiculosList = [];
let conductoresList = [];
let isEditing = false;
let historyData = [];

document.addEventListener('DOMContentLoaded', () => {
    if(!user) document.getElementById('loginScreen').style.display = 'flex';
    else initApp();
});

document.getElementById('loginForm').addEventListener('submit', async(e) => {
    e.preventDefault();
    
    // Referencias a los inputs para manipular estilos
    const uInput = document.getElementById('user');
    const pInput = document.getElementById('pass');
    
    const u = uInput.value;
    const p = pInput.value;

    // Resetear estilos previos (quitar rojo si lo tienen)
    uInput.style.borderColor = '';
    pInput.style.borderColor = '';

    try {
        const res = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user:u, pass:p})});
        if(res.ok){
            const d = await res.json();
            localStorage.setItem('sidma_user', JSON.stringify(d.user));
            location.reload();
        } else { 
            // --- ESTADO DE ERROR DE VALIDACIÓN ---
            
            // 1. Marcar bordes en rojo
            uInput.style.borderColor = '#ef4444';
            pInput.style.borderColor = '#ef4444';
            
            // 2. Limpiar campo de contraseña
            pInput.value = '';
            pInput.focus();

            // 3. Mostrar Alerta de Error
            Swal.fire({
                title: 'Error de Acceso',
                text: 'Usuario o contraseña incorrectos. Por favor verifique.',
                icon: 'error',
                confirmButtonColor: '#ef4444',
                confirmButtonText: 'Reintentar'
            });
        }
    } catch (e) { 
        Swal.fire('Error de Conexión', 'No se pudo conectar con el servidor', 'error'); 
    }
});

async function initApp(){
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('appLayout').style.display='block';
    document.getElementById('uName').textContent = user.nombre;
    document.getElementById('uRole').textContent = user.rol.toUpperCase();
    
    document.getElementById('btnOpenHistory').style.display = 'flex';

    document.querySelectorAll('.role-section').forEach(el => el.style.display='none');
    document.getElementById(`view-${user.rol}`).style.display='block';
    
    if(user.rol === 'operador') {
        document.getElementById('cFecha').value = new Date().toISOString().split('T')[0];
        addClienteBlock(); 
    }
    await loadData();
}

window.refreshData = async () => {
    const btn = document.getElementById('btnRefresh');
    const icon = btn.querySelector('i');
    const span = btn.querySelector('span');
    btn.disabled = true; icon.classList.add('fa-spin'); span.textContent = 'Cargando...';
    try {
        await loadData(); 
        icon.classList.remove('fa-spin','fa-rotate-right'); icon.classList.add('fa-check'); span.textContent = '¡Al día!';
        btn.style.background = 'var(--green)'; btn.style.borderColor = 'var(--green)';
    } catch (e) { span.textContent = 'Error'; btn.style.background = 'var(--danger)'; }
    setTimeout(() => {
        icon.classList.remove('fa-check'); icon.classList.add('fa-rotate-right'); span.textContent = 'Actualizar';
        btn.style.background = ''; btn.style.borderColor = ''; btn.disabled = false;
    }, 2000);
};

async function loadData(){
    const res = await fetch('/api/data');
    const d = await res.json();
    vehiculosList = d.vehiculos;
    conductoresList = d.conductores;
    rawData = (d.despachos || []).map(r => {
        let item = {}; for(let k in r) item[k.toLowerCase().trim()] = r[k];
        try { item.detalles = JSON.parse(item.detalles_clientes_json); } catch { item.detalles = []; }
        try { item.gastos = JSON.parse(item.gastos_adicionales); } catch { item.gastos = []; }
        return item;
    });
    renderViews();
}

function renderViews(){
    if(user.rol === 'operador') renderOperador();
    if(user.rol === 'admin') renderAdmin();
    if(user.rol === 'conductor') renderConductor();
}

// --- COMUNES ---
window.borrarRuta = async (id) => {
    const result = await Swal.fire({title: '¿Eliminar?', text: "Se borrará permanentemente", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Sí, borrar'});
    if(result.isConfirmed) { await fetch(`/api/borrar/${id}`, { method: 'DELETE' }); loadData(); Swal.fire('Borrado', '', 'success'); if(isEditing) cancelEditMode(); }
};

// --- OPERADOR ---
window.addClienteBlock = (name='', prods=[]) => {
    const div = document.createElement('div'); div.className = 'client-block';
    div.innerHTML = `<div class="block-header"><span>Cliente</span><button type="button" onclick="this.parentElement.parentElement.remove(); calcTotal()" class="btn-del small">X</button></div>
    <input type="text" class="cl-name" placeholder="Nombre Cliente" value="${name}"><div class="prod-list"></div><button type="button" onclick="addProdRow(this)" class="btn-sec small">+ Producto</button>`;
    document.getElementById('clientesContainer').appendChild(div);
    const btn = div.querySelector('.btn-sec');
    if(prods.length > 0) prods.forEach(p => addProdRow(btn, p.producto, p.kg));
    else addProdRow(btn);
};
window.addProdRow = (btn, name='', kg='') => {
    const row = document.createElement('div'); row.className = 'prod-row';
    row.innerHTML = `<input type="text" class="pr-name" placeholder="Prod" style="flex:2" value="${name}"><input type="number" class="pr-kg" placeholder="Kg" oninput="calcTotal()" style="flex:1" value="${kg}"><button type="button" onclick="this.parentElement.remove(); calcTotal()" class="btn-del small">x</button>`;
    btn.previousElementSibling.appendChild(row);
    if(kg) calcTotal();
};
window.calcTotal = () => { let t = 0; document.querySelectorAll('.pr-kg').forEach(i => t += parseFloat(i.value) || 0); document.getElementById('cTotalKg').innerText = t; };

window.loadOrderToEdit = (id) => {
    const r = rawData.find(x => x.id == id); if(!r) return;
    isEditing = true; document.getElementById('editId').value = id;
    document.getElementById('btnCancelEdit').style.display = 'block';
    document.getElementById('btnSubmitOperador').textContent = 'ACTUALIZAR RUTA';
    document.getElementById('btnSubmitOperador').style.background = '#f59e0b';
    document.getElementById('cFecha').value = r.fecha_entrega.split('T')[0];
    document.getElementById('cNombre').value = r.nombre_ruta;
    document.getElementById('cObs').value = r.observaciones || '';
    document.getElementById('clientesContainer').innerHTML = '';
    r.detalles.forEach(c => addClienteBlock(c.cliente, c.productos));
    calcTotal(); window.scrollTo({top:0, behavior:'smooth'});
};
window.cancelEditMode = () => {
    isEditing = false; document.getElementById('btnCancelEdit').style.display = 'none';
    document.getElementById('btnSubmitOperador').textContent = 'GUARDAR Y CREAR RUTA';
    document.getElementById('btnSubmitOperador').style.background = '#3b82f6';
    document.getElementById('formCrear').reset(); document.getElementById('clientesContainer').innerHTML = '';
    addClienteBlock(); document.getElementById('cTotalKg').innerText = '0';
};
document.getElementById('formCrear').addEventListener('submit', async(e) => {
    e.preventDefault();
    const detalles = [];
    document.querySelectorAll('.client-block').forEach(cb => {
        const cName = cb.querySelector('.cl-name').value;
        if(cName){
            const prods = [];
            cb.querySelectorAll('.prod-row').forEach(pr => prods.push({producto: pr.querySelector('.pr-name').value, kg: pr.querySelector('.pr-kg').value, estado: 'Pendiente'}));
            detalles.push({ cliente: cName, productos: prods });
        }
    });
    const body = {
        fecha: document.getElementById('cFecha').value,
        nombre_ruta: document.getElementById('cNombre').value,
        total_kg: document.getElementById('cTotalKg').innerText,
        detalles: JSON.stringify(detalles),
        observaciones: document.getElementById('cObs').value
    };
    let url = isEditing ? `/api/editar/${document.getElementById('editId').value}` : '/api/crear';
    let method = isEditing ? 'PUT' : 'POST';
    const res = await fetch(url, {method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(res.ok){ Swal.fire('Guardado', '', 'success'); cancelEditMode(); loadData(); }
});
function renderOperador(){
    const list = rawData.filter(x => x.estado === 'Creada');
    const c = document.getElementById('listCreadas'); c.innerHTML = '';
    list.forEach(r => {
        c.innerHTML += `<div class="card item-card status-creada" style="cursor:pointer" onclick="loadOrderToEdit('${r.id}')">
            <div style="display:flex; justify-content:space-between"><h4>${r.nombre_ruta}</h4><div><i class="fa-solid fa-pen" style="color:#f59e0b"></i></div></div>
            <p>${r.fecha_entrega.slice(0,10)} | ${r.total_kg_ruta} Kg</p>
            <div class="grid-2 mt">
                <button onclick="event.stopPropagation(); openTicket('${r.id}')" class="btn-sec small">🖨️ Tiquete</button>
                <button onclick="event.stopPropagation(); borrarRuta('${r.id}')" class="btn-del small">🗑️ Borrar</button>
            </div>
        </div>`;
    });
}

// --- ADMIN ---
function renderAdmin(){
    const pen = rawData.filter(x => x.estado === 'Creada');
    const asg = rawData.filter(x => x.estado === 'Asignada');
    const cp = document.getElementById('listPorAsignar'); cp.innerHTML = '';
    pen.forEach(r => {
        cp.innerHTML += `<div class="card item-card status-creada">
            <div style="display:flex; justify-content:space-between"><h4>${r.nombre_ruta}</h4><button onclick="borrarRuta('${r.id}')" class="btn-del small"><i class="fa-solid fa-trash"></i></button></div>
            <p>${r.fecha_entrega.slice(0,10)} | ${r.total_kg_ruta} Kg</p>
            <div class="grid-2 mt"><button onclick="openTicket('${r.id}')" class="btn-sec">🖨️ Ver</button><button onclick="openAsignar('${r.id}')" class="btn-primary">ASIGNAR</button></div>
        </div>`;
    });
    const ca = document.getElementById('listAsignadas'); ca.innerHTML = '';
    asg.forEach(r => ca.innerHTML += `<div class="card item-card status-asignada">
        <div style="display:flex; justify-content:space-between"><h4>${r.nombre_ruta}</h4><button onclick="borrarRuta('${r.id}')" class="btn-del small"><i class="fa-solid fa-trash"></i></button></div>
        <p>${r.placa_vehiculo} | ${r.conductor_asignado}</p>
        <div class="grid-2 mt"><button onclick="openTicket('${r.id}')" class="btn-sec">🖨️ Ver</button><button onclick="openAsignar('${r.id}')" class="btn-sec" style="color:var(--orange); border-color:var(--orange)">✏️ Editar</button></div>
    </div>`);
}

// --- ASIGNACIÓN CON DATOS VISIBLES ---
window.openAsignar = (id) => {
    const r = rawData.find(x => x.id == id); 
    document.getElementById('asgId').value = id;
    
    // MOSTRAR RESUMEN Y OBSERVACIONES
    const obs = r.observaciones && r.observaciones.trim() !== '' ? r.observaciones : '<em style="opacity:0.6">Sin observaciones</em>';
    const cliCount = r.detalles.length;
    document.getElementById('asgResumen').innerHTML = `
        <div style="margin-bottom:5px"><strong>Ruta:</strong> ${r.nombre_ruta}</div>
        <div style="margin-bottom:5px"><strong>Fecha:</strong> ${r.fecha_entrega.slice(0,10)} | <strong>Total:</strong> ${r.total_kg_ruta} Kg</div>
        <div style="margin-bottom:5px"><strong>Clientes:</strong> ${cliCount}</div>
        <div style="margin-top:8px; padding-top:5px; border-top:1px dashed #555; color:var(--orange)">
            <strong><i class="fa-solid fa-circle-exclamation"></i> Obs:</strong> ${obs}
        </div>
    `;

    const sp = document.getElementById('asgPlaca'); sp.innerHTML = '<option value="">Vehículo...</option>';
    vehiculosList.forEach(v => sp.innerHTML += `<option value="${v.placa}" ${v.placa===r.placa_vehiculo?'selected':''}>${v.placa}</option>`);
    const sc = document.getElementById('asgConductor'); sc.innerHTML = '<option value="">Conductor...</option>';
    conductoresList.forEach(c => sc.innerHTML += `<option value="${c.nombre}" ${c.nombre===r.conductor_asignado?'selected':''}>${c.nombre}</option>`);
    document.getElementById('asgTipo').value = r.tipo_comision || 'variable';
    document.getElementById('asgValor').value = r.valor_tarifa || '';
    document.getElementById('modalAsignar').style.display = 'flex';
};
window.submitAsignar = async() => {
    const id = document.getElementById('asgId').value;
    const body = { placa: document.getElementById('asgPlaca').value, conductor: document.getElementById('asgConductor').value, tipo_comision: document.getElementById('asgTipo').value, valor_tarifa: document.getElementById('asgValor').value };
    await fetch(`/api/asignar/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    document.getElementById('modalAsignar').style.display = 'none'; loadData();
};

// --- CONDUCTOR ---
function renderConductor(){
    const l = rawData.filter(x => x.conductor_asignado === user.nombre && x.estado === 'Asignada');
    const c = document.getElementById('listMisRutas'); c.innerHTML = '';
    l.forEach(r => {
        let details = ''; r.detalles.forEach(d => details += `<li>${d.cliente}</li>`);
        c.innerHTML += `<div class="card item-card status-asignada"><h3>${r.nombre_ruta}</h3><p>${r.total_kg_ruta} Kg</p><ul style="font-size:0.8rem; color:#ccc; padding-left:20px">${details}</ul><div class="grid-2 mt"><button onclick="openTicket('${r.id}')" class="btn-sec">🖨️</button><button onclick="openFin('${r.id}')" class="btn-primary">ENTREGAR</button></div></div>`;
    });
}
window.openFin = (id) => {
    const r = rawData.find(x => x.id == id); document.getElementById('finId').value = id;
    const b = document.getElementById('checklistProds'); b.innerHTML = '';
    r.detalles.forEach((c,ic) => {
        let h = `<div class="check-group"><strong>${c.cliente}</strong>`;
        c.productos.forEach((p,ip) => h += `<div class="check-item"><span>${p.producto} (${p.kg}kg)</span><label class="toggle"><input type="checkbox" class="chk-dev" data-kg="${p.kg}" data-ic="${ic}" data-ip="${ip}" onchange="recalc()"><span class="slider"></span></label></div>`);
        b.innerHTML += h + '</div>';
    });
    document.getElementById('gastosContainer').innerHTML=''; recalc(); document.getElementById('modalFinalizar').style.display='flex';
};
window.recalc = () => {
    const r = rawData.find(x => x.id == document.getElementById('finId').value);
    let kg = parseFloat(r.total_kg_ruta)||0; document.querySelectorAll('.chk-dev:checked').forEach(c => kg -= parseFloat(c.dataset.kg));
    const tar = parseFloat(r.valor_tarifa)||0; let base = (r.tipo_comision === 'variable') ? kg*tar : tar;
    let g = 0; document.querySelectorAll('.g-val').forEach(i => g += parseFloat(i.value)||0);
    document.getElementById('finKg').innerText = kg.toFixed(1); document.getElementById('finBase').innerText = '$'+Math.round(base);
    document.getElementById('finTotal').innerText = '$'+Math.round(base+g);
};
window.addGastoRow = () => {
    const d = document.createElement('div'); d.className='grid-2 mini-grid'; d.innerHTML = `<input type="text" class="g-desc" placeholder="Desc."><input type="number" class="g-val" placeholder="$" oninput="recalc()">`; document.getElementById('gastosContainer').appendChild(d);
};
window.submitFinalizar = async() => {
    const id = document.getElementById('finId').value; const r = rawData.find(x => x.id == id);
    document.querySelectorAll('.chk-dev').forEach(c => r.detalles[c.dataset.ic].productos[c.dataset.ip].estado = c.checked?'Devuelto':'Entregado');
    const g = []; document.querySelectorAll('#gastosContainer .grid-2').forEach(e => g.push({desc:e.querySelector('.g-desc').value, val:e.querySelector('.g-val').value}));
    const fd = new FormData(); fd.append('detalles_actualizados', JSON.stringify(r.detalles)); fd.append('gastos_json', JSON.stringify(g)); fd.append('total_pagar', document.getElementById('finTotal').innerText.replace(/[$,]/g,''));
    
    // CAMBIO: La foto ahora es opcional.
    if(document.getElementById('finFoto').files[0]) {
        fd.append('foto', document.getElementById('finFoto').files[0]);
    }
    
    Swal.fire({title:'Enviando', didOpen:()=>Swal.showLoading()}); await fetch(`/api/finalizar/${id}`, {method:'PUT', body:fd});
    document.getElementById('modalFinalizar').style.display='none'; loadData(); Swal.fire('Hecho','','success');
};

// --- HISTORIAL ---
window.openHistory = () => {
    const d = new Date();
    document.getElementById('histIni').value = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    document.getElementById('histFin').value = d.toISOString().split('T')[0];
    const sp = document.getElementById('histPlaca'); sp.innerHTML = '<option value="">Todas</option>';
    vehiculosList.forEach(v => sp.innerHTML += `<option value="${v.placa}">${v.placa}</option>`);
    const sc = document.getElementById('histCond'); sc.innerHTML = '<option value="">Todos</option>';
    conductoresList.forEach(c => sc.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`);
    if(user.rol === 'conductor') { sc.value = user.nombre; sc.disabled = true; } else { sc.disabled = false; }
    renderHistoryTable(); document.getElementById('modalHistory').style.display = 'flex';
};

window.renderHistoryTable = () => {
    const ini = document.getElementById('histIni').value;
    const fin = document.getElementById('histFin').value;
    const pFilter = document.getElementById('histPlaca').value;
    const cFilter = (user.rol === 'conductor') ? user.nombre : document.getElementById('histCond').value;
    
    historyData = rawData.filter(r => {
        const d = r.fecha_entrega.split('T')[0];
        const inDate = (!ini || d >= ini) && (!fin || d <= fin);
        const inPlaca = !pFilter || r.placa_vehiculo === pFilter;
        const inCond = !cFilter || r.conductor_asignado === cFilter;
        return r.estado === 'Finalizada' && inDate && inPlaca && inCond;
    });

    let tKg = 0, tCom = 0;
    const tbody = document.querySelector('#tableHistory tbody'); tbody.innerHTML = '';
    historyData.forEach(r => {
        let kgEntr = 0; r.detalles.forEach(c => c.productos.forEach(p => { if(p.estado!=='Devuelto') kgEntr += parseFloat(p.kg)||0; }));
        const tarifa = parseFloat(r.valor_tarifa)||0;
        const comision = (r.tipo_comision === 'variable') ? (kgEntr * tarifa) : tarifa;
        tKg += kgEntr; tCom += comision;
        
        // CAMBIO: Botón de foto si existe evidencia
        const btnFoto = r.evidencia_foto ? 
            `<button onclick="verFoto('${r.evidencia_foto}')" class="btn-sec small" style="margin-right:5px; color:#3b82f6; border-color:#3b82f6;" title="Ver Foto">📷</button>` : '';

        tbody.innerHTML += `<tr>
            <td>${r.fecha_entrega.slice(0,10)}</td>
            <td>${r.placa_vehiculo}</td>
            <td>${r.conductor_asignado}</td>
            <td>${kgEntr.toLocaleString()}</td>
            <td>$${tarifa.toLocaleString()}</td>
            <td>$${Math.round(comision).toLocaleString()}</td>
            <td style="display:flex; justify-content:center; align-items:center;">
                ${btnFoto}
                <button onclick="openTicket('${r.id}')" class="btn-sec small" title="Imprimir">🖨️</button>
            </td>
        </tr>`;
    });
    document.getElementById('hCount').textContent = historyData.length;
    document.getElementById('hKg').textContent = tKg.toLocaleString();
    document.getElementById('hComision').textContent = '$' + tCom.toLocaleString();
};

// NUEVA FUNCIÓN: Ver Foto
window.verFoto = (url) => {
    Swal.fire({
        imageUrl: url,
        imageAlt: 'Evidencia',
        width: 600,
        imageWidth: '100%',
        showCloseButton: true,
        showConfirmButton: false,
        background: '#1e293b', // Color de fondo oscuro acorde al tema
        color: '#fff'
    });
};

window.exportHistoryCSV = () => {
    let csv = "\uFEFFFECHA;PLACA;CONDUCTOR;KG ENTREGADOS;TARIFA;COMISION;PAGO TOTAL\n";
    historyData.forEach(r => {
        let kgEntr = 0; r.detalles.forEach(c => c.productos.forEach(p => { if(p.estado!=='Devuelto') kgEntr += parseFloat(p.kg)||0; }));
        const tarifa = parseFloat(r.valor_tarifa)||0;
        const comision = (r.tipo_comision === 'variable') ? (kgEntr * tarifa) : tarifa;
        csv += `${r.fecha_entrega.slice(0,10)};${r.placa_vehiculo};${r.conductor_asignado};${kgEntr};${tarifa};${comision};${r.total_pagar_conductor}\n`;
    });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'}));
    a.download = `Historial_${new Date().toISOString().slice(0,10)}.csv`; a.click();
};

// --- TIQUETE CON OBSERVACIONES (FIX) ---
window.generateTicketHTML = (r) => {
    let listHTML = '';
    
    r.detalles.forEach(c => {
        listHTML += `<div style="margin-top:8px; font-weight:bold; border-bottom:1px solid #000; font-size:12px;">${c.cliente.toUpperCase()}</div>`;
        c.productos.forEach(p => {
            const isDev = p.estado === 'Devuelto';
            const style = isDev ? 't-devuelto' : '';
            const tag = isDev ? '<span class="t-tag-dev">[DEV]</span>' : '';
            listHTML += `<div class="t-row ${style}" style="font-size:11px; padding-left:5px">
                <span style="flex:1">- ${p.producto} ${tag}</span>
                <span style="font-weight:bold">${p.kg} Kg</span>
            </div>`;
        });
    });

    let gastosHTML = '';
    let gastosTotal = 0;
    if(r.gastos && r.gastos.length) {
        gastosHTML = `<div class="t-divider"></div><div class="t-bold" style="margin-top:5px">GASTOS ADICIONALES:</div>`;
        r.gastos.forEach(g => { gastosHTML += `<div class="t-row"><span>${g.desc}</span><span>$${Number(g.val).toLocaleString()}</span></div>`; gastosTotal += Number(g.val); });
    }

    const tarifaVal = Number(r.valor_tarifa || 0);
    let comisionVal = (r.tipo_comision === 'variable') ? (Number(r.total_kg_ruta) * tarifaVal) : tarifaVal;
    const totalPagar = r.estado === 'Finalizada' ? Number(r.total_pagar_conductor) : (comisionVal + gastosTotal);
    
    // MOSTRAR OBSERVACIONES SI EXISTEN
    const obsText = r.observaciones ? r.observaciones : '';
    const obsHTML = obsText ? 
        `<div style="margin-top:15px; border:1px dashed #000; padding:5px; font-size:11px; background:#eee;">
            <strong>OBSERVACIONES:</strong><br>${obsText}
         </div>` : '';

    return `
    <div class="t-header">
        <h2 style="margin:0; font-size:12px">🌾Agrollanos Sas </h2>
        <p style="margin:2px 0">NIT: 830104572</p>
        <p style="font-weight:bold; font-size:14px; margin-top:5px">MANIFIESTO DE CARGA #${r.id.toString().slice(-4)}</p>
    </div>
    
    <div style="font-size:12px; margin-bottom:10px;">
        <div class="t-row"><span>Ruta:</span><strong>${r.nombre_ruta}</strong></div>
        <div class="t-row"><span>Fecha:</span><span>${r.fecha_entrega.slice(0,10)}</span></div>
        <div class="t-row"><span>Vehículo:</span><span>${r.placa_vehiculo||'---'}</span></div>
        <div class="t-row"><span>Conductor:</span><span>${r.conductor_asignado||'---'}</span></div>
    </div>
    
    <div class="t-divider"></div>
    <div style="text-align:center;font-weight:bold; margin:5px 0;">DETALLE DE CARGA</div>
    ${listHTML}
    
    <div class="t-divider"></div>
    <div class="t-row" style="font-size:13px; margin-top:5px;"><strong>TOTAL CARGA:</strong><strong>${r.total_kg_ruta} Kg</strong></div>
    
    <div class="t-divider"></div>
    <div class="t-row"><span>Tarifa (${r.tipo_comision||'-'}):</span><span>$${tarifaVal.toLocaleString()}</span></div>
    <div class="t-row"><span>Comisión Base:</span><span>$${comisionVal.toLocaleString()}</span></div>
    ${gastosHTML}
    
    <div class="t-divider"></div>
    <div class="t-row" style="font-size:15px; margin-top:5px"><strong>TOTAL A PAGAR:</strong><strong>$${totalPagar.toLocaleString()}</strong></div>
    
    ${obsHTML}

    <br><br><br>
    
    <div style="text-align:center; font-size:10px; color:#555">Generado por SIDMA LOG | ${new Date().toLocaleString()}</div>
    `;
};

window.openTicket = (id) => {
    const r = rawData.find(x => x.id == id);
    const h = generateTicketHTML(r);
    document.getElementById('ticketPreviewContent').innerHTML = h;
    document.getElementById('printArea').innerHTML = h;
    document.getElementById('modalTicket').style.display = 'flex';
};
window.printNow = () => window.print();
window.closeModal = (id) => document.getElementById(id).style.display='none';
window.logout = () => { localStorage.removeItem('sidma_user'); location.reload(); };