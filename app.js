let user = JSON.parse(localStorage.getItem('sidma_user')) || null;
let rawDespachos = [];
let rawPedidos = [];
let vehiculosList = [];
let conductoresList = [];
let historyData = [];
let isProcessingAction = false;

// Variables Paginación e Historial
let curHistPage = 1;
const itemsPerPage = 5;
let currentHistoryFiltered = []; 

// Variables Memoria (Autocompletado)
let knownClients = new Set();
let knownProducts = new Set();

// Variable para el Tiquete actual
let currentTicketRoute = null;

const LOCALE = 'es-CO';
const TIMEZONE = 'America/Bogota';
const fmtMoney = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** FORMATEADORES **/
const fmtDate = (iso) => { 
    if(!iso) return ''; 
    if(iso.includes('-') && !iso.includes('T')) { 
        const [y,m,d]=iso.split('-'); 
        return `${d}/${m}/${y}`; 
    } 
    try { return new Date(iso).toLocaleDateString(LOCALE, { timeZone: TIMEZONE }); } 
    catch { return iso; }
};

const fmtTime = (raw) => { 
    if(!raw) return ''; 
    if(raw.includes('T')) { 
        try { return new Date(raw).toLocaleTimeString('en-GB',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit'}); } 
        catch { const parts = raw.split('T'); return parts.length > 1 ? parts[1].substring(0,5) : raw.substring(0,5); } 
    } 
    return raw.length > 5 ? raw.substring(0,5) : raw; 
};

const getBogotaDateISO = () => { 
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: TIMEZONE})); 
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); 
};

/** INICIO Y LOGIN **/
document.addEventListener('DOMContentLoaded', () => { 
    if(!user) document.getElementById('loginScreen').style.display = 'flex'; 
    else initApp(); 
});

document.getElementById('loginForm').addEventListener('submit', async(e) => {
    e.preventDefault(); 
    if(isProcessingAction) return;
    isProcessingAction = true;
    const u = document.getElementById('user').value; 
    const p = document.getElementById('pass').value;
    try { 
        const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user:u, pass:p}) }); 
        if(res.ok){ 
            const d = await res.json(); 
            localStorage.setItem('sidma_user', JSON.stringify(d.user)); 
            location.reload(); 
        } else { Swal.fire('Error', 'Credenciales incorrectas', 'error'); } 
    } catch { Swal.fire('Error', 'Sin conexión', 'error'); } 
    finally { isProcessingAction = false; }
});

async function initApp(){
    document.getElementById('loginScreen').style.display='none'; 
    document.getElementById('appLayout').style.display='block';
    document.getElementById('uName').textContent = user.nombre; 
    document.getElementById('uRole').textContent = user.rol.toUpperCase();
    document.querySelectorAll('.role-section').forEach(el => el.style.display='none'); 
    document.getElementById(`view-${user.rol}`).style.display='block';
    initHistoryFilters();
    await loadData();
}

/** CARGA DE DATOS **/
async function loadData(){
    const res = await fetch('/api/data'); 
    const d = await res.json();
    vehiculosList = (d.vehiculos || []).map(processRow);
    conductoresList = (d.conductores || []).map(processRow);
    rawDespachos = (d.despachos || []).map(processRow);
    rawPedidos = (d.pedidos || []).map(p => { 
        let item = processRow(p); 
        try { item.productos = JSON.parse(item.productos_json || item.productos); } 
        catch { item.productos = []; } 
        item.total_kg = item.productos.reduce((acc, x) => acc + (parseFloat(x.kg_plan)||0), 0); 
        return item; 
    });
    extractUniqueData();
    renderViews();
    fetch('/api/historial').then(r => r.json()).then(hist => { historyData = hist.map(processRow); extractUniqueData(); });
}

function processRow(r) { 
    let item = {}; 
    for(let k in r) item[k.toLowerCase().trim()] = r[k]; 
    if (item.detalles_clientes_json) try { item.detalles = JSON.parse(item.detalles_clientes_json); } catch { item.detalles = []; }
    if (item.gastos_adicionales) try { item.gastos = JSON.parse(item.gastos_adicionales); } catch { item.gastos = []; }
    return item; 
}

/** VISTAS (ADMIN / OPERADOR / CONDUCTOR) **/
function renderViews(){ 
    if(user.rol === 'operador') renderOperador(); 
    if(user.rol === 'admin') renderAdmin(); 
    if(user.rol === 'conductor') renderConductor(); 
}

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
}

function renderAdmin() {
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

/** WHATSAPP ACTUALIZADO (SOLUCIÓN ICONOS) **/
window.sendWhatsAppTicket = () => {
    if (!currentTicketRoute) return;
    const r = currentTicketRoute;
    const esFinalizada = (r.estado === 'Finalizada' || r.fecha_entrega);
    
    // Construcción del mensaje con Emojis estándar
    let msg = `*AGROLLANOS - MANIFIESTO #${r.id.toString().slice(-4)}*\n`;
    msg += `📅 *Fecha:* ${fmtDate(r.fecha || r.fecha_entrega)}\n`;
    msg += `⏰ *Hora:* ${fmtTime(r.hora || r.hora_entrega)}\n`;
    msg += `👤 *Conductor:* ${r.conductor_asignado}\n`;
    msg += `🚛 *Placa:* ${r.placa_vehiculo}\n`;
    msg += `📍 *Ruta:* ${r.nombre_ruta}\n`;
    msg += `\n*DETALLE DE CARGA:*\n`;
    
    r.detalles.forEach(c => { 
        msg += `• *${c.cliente.toUpperCase()}* (Ord: ${c.orden || 'S/N'})\n`; 
        if (c.observaciones) msg += `   _(Obs: ${c.observaciones})_\n`;
        c.productos.forEach(p => { 
            const kgEnt = p.kg_ent !== undefined ? p.kg_ent : p.kg_plan;
            const kgPlan = p.kg_plan_orig || p.kg_plan;
            if (esFinalizada && kgEnt < kgPlan) {
                msg += `   - ${p.producto}: *${fmtNum.format(kgEnt)}* / ${fmtNum.format(kgPlan)} Kg\n`;
            } else {
                msg += `   - ${p.producto}: ${fmtNum.format(parseFloat(kgEnt))} Kg\n`; 
            }
        }); 
    });
    
    msg += `\n📦 *Total:* ${fmtNum.format(r.total_kg_entregados_real || r.total_kg_ruta)} Kg\n`;

    if (esFinalizada) {
        const kgReal = parseFloat(r.total_kg_entregados_real) || 0;
        const tarifa = parseFloat(r.valor_tarifa) || 0;
        const comision = (r.tipo_comision === 'variable') ? (kgReal * tarifa) : tarifa;
        let tGastos = 0;
        if (r.gastos) r.gastos.forEach(g => tGastos += parseFloat(g.val)||0);
        
        msg += `\n*RESUMEN PAGO CONDUCTOR:*`;
        msg += `\n💵 Comisión: ${fmtMoney.format(comision)}`;
        if (tGastos > 0) msg += `\n⛽ Gastos: ${fmtMoney.format(tGastos)}`;
        msg += `\n✅ *TOTAL:* ${fmtMoney.format(comision + tGastos)}`;
    }
    
    if (r.observaciones) msg += `\n📝 *Obs:* ${r.observaciones}`;

    // Codificación segura para evitar errores de símbolos
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
};

/** GESTIÓN DE MODALES Y FORMULARIOS (RESTO DEL CÓDIGO) **/
window.openTicket = (id) => {
    const r = rawDespachos.find(x => String(x.id) === String(id)) || historyData.find(x => String(x.id) === String(id));
    if(!r) return;
    currentTicketRoute = r;
    // ... (Lógica de vista previa del ticket permanece igual)
    document.getElementById('modalTicket').style.display = 'flex';
};

window.closeModal = (id) => document.getElementById(id).style.display='none';
window.logout = () => { localStorage.removeItem('sidma_user'); location.reload(); };

// (Incluir aquí el resto de funciones: openPedidoModal, calcTotalPedido, submitFinalizar, etc. 
// del código original sin cambios adicionales requeridos).
