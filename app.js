let currentUser = JSON.parse(localStorage.getItem('sidma_user')) || null;
let allData = [];
let filteredData = [];
let currentPage = 1;
const recordsPerPage = 20;
let isEdit = false;
let editId = null;

document.addEventListener('DOMContentLoaded', () => {
    if (!currentUser) {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-content').style.display = 'none';
    } else {
        initApp();
    }
});

// --- SISTEMA DE LOGIN ---
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({user, pass})
        });
        
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('sidma_user', JSON.stringify(data.user));
            location.reload();
        } else {
            Swal.fire('Error', 'Usuario o clave incorrectos', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'No hay conexión con el servidor', 'error');
    }
});

async function initApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';
    document.getElementById('txtUser').innerText = currentUser.nombre;
    document.getElementById('lblRol').innerText = currentUser.rol.toUpperCase();
    
    const isAdm = currentUser.rol === 'admin';
    document.getElementById('btnNavNew').style.display = isAdm ? 'block' : 'none';
    
    await cargarListaConductores();
    loadData();
    
    document.getElementById('formDespacho').addEventListener('input', calcularTotales);
}

async function cargarListaConductores() {
    try {
        const res = await fetch('/api/conductores');
        const data = await res.json();
        const select = document.getElementById('inpConductor');
        select.innerHTML = '<option value="">Seleccione Conductor...</option>';
        data.forEach(c => {
            select.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`;
        });
    } catch (e) { console.error("Error conductores", e); }
}

async function loadData() {
    try {
        const res = await fetch('/api/despachos');
        const d = await res.json();
        allData = (d.data || []).map(item => {
            let n = {}; for(let k in item) n[k.toLowerCase().trim()] = item[k];
            return n;
        });
        aplicarFiltros();
    } catch(e) { console.error(e); }
}

function aplicarFiltros() {
    const ft = document.getElementById('filtroTexto').value.toLowerCase();
    const fi = document.getElementById('filtroInicio').value;
    const ff = document.getElementById('filtroFin').value;
    const fs = document.getElementById('filtroEstado').value;
    const isAdm = currentUser.rol === 'admin';
    
    filteredData = allData.filter(i => {
        const matchPropio = isAdm || i.conductor.toLowerCase().trim() === currentUser.nombre.toLowerCase().trim();
        const f = i.fecha ? i.fecha.split('T')[0] : '';
        const matchFecha = (!fi || f >= fi) && (!ff || f <= ff);
        const matchTexto = !ft || (i.conductor + i.cliente).toLowerCase().includes(ft);
        const matchEstado = !fs || i.estado === fs;
        return matchPropio && matchFecha && matchTexto && matchEstado;
    });
    currentPage = 1;
    renderTables();
}

function renderTables() {
    const isAdm = currentUser.rol === 'admin';
    const start = (currentPage - 1) * recordsPerPage;
    const paginated = filteredData.slice(start, start + recordsPerPage);

    renderRows('tablaPendientes', paginated.filter(i => i.estado !== 'Entregado'), isAdm);
    renderRows('tablaFinalizados', paginated.filter(i => i.estado === 'Entregado'), isAdm);
    
    document.getElementById('pageInfo').textContent = `Página ${currentPage}`;
    actualizarResumen();
}

function renderRows(tableId, data, isAdm) {
    const tbody = document.getElementById(tableId);
    tbody.innerHTML = '';
    data.forEach(item => {
        const tr = document.createElement('tr');
        const itemStr = encodeURIComponent(JSON.stringify(item));
        const btnFoto = item.foto ? `<button onclick="verFoto('${item.foto}')" class="btn-act view-foto">📷</button>` : '';
        
        tr.innerHTML = `
            <td>${item.fecha ? item.fecha.slice(5,10) : ''}</td>
            <td><strong>${item.conductor}</strong></td>
            <td>${item.cliente}</td>
            <td>${item.total_kg_entregado}kg</td>
            <td style="display:${isAdm ? 'table-cell' : 'none'}">$${Number(item.total_comision).toLocaleString()}</td>
            <td>
                ${btnFoto}
                <button onclick="editar('${itemStr}')" class="btn-act edit">✎</button>
                ${isAdm ? `
                <button onclick="prepararTiquete('${itemStr}')" class="btn-act print">🖨️</button>
                <button onclick="borrarRegistro('${item.id}')" class="btn-act del">🗑️</button>` : ''}
            </td>`;
        tbody.appendChild(tr);
    });
}

document.getElementById('formDespacho').addEventListener('submit', async (e) => {
    e.preventDefault();
    Swal.fire({title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    const fd = new FormData();
    fd.append('conductor', document.getElementById('inpConductor').value);
    fd.append('fecha', document.getElementById('inpDate').value);
    fd.append('cliente', document.getElementById('inpCliente').value);
    fd.append('estado', document.getElementById('inpEstado').value);
    fd.append('lista_productos_texto', document.getElementById('listaProductosTexto').value);
    fd.append('total_kg_salida', document.getElementById('inpTotalSalida').value);
    fd.append('total_kg_entregado', document.getElementById('inpTotalEntregado').value);
    fd.append('tarifa_comision', document.getElementById('inpTarifa').value);
    fd.append('observaciones', document.getElementById('inpObs').value);

    const f = document.getElementById('inpFoto').files[0];
    if(f) fd.append('foto', f);
    if(isEdit) fd.append('foto_actual', document.getElementById('fotoActual').value);

    const url = isEdit ? `/api/despachos/${editId}` : '/api/despachos';
    try {
        const res = await fetch(url, { method: isEdit ? 'PUT' : 'POST', body: fd });
        if((await res.json()).success) {
            Swal.fire('Éxito', 'Guardado correctamente', 'success');
            resetForm(); loadData(); verTab('list');
        }
    } catch(err) { Swal.fire('Error', 'No se pudo guardar', 'error'); }
});

window.editar = (str) => {
    const item = JSON.parse(decodeURIComponent(str));
    const isAdm = currentUser.rol === 'admin';
    isEdit = true; editId = item.id; verTab('form');
    
    document.getElementById('inpDate').value = item.fecha ? item.fecha.split('T')[0] : '';
    document.getElementById('inpCliente').value = item.cliente;
    document.getElementById('inpConductor').value = item.conductor;
    document.getElementById('inpTotalEntregado').value = item.total_kg_entregado;
    document.getElementById('inpTarifa').value = item.tarifa_comision;
    document.getElementById('inpEstado').value = item.estado;
    document.getElementById('inpObs').value = item.observacion || item.observaciones || '';
    document.getElementById('fotoActual').value = item.foto || '';

    document.getElementById('inpDate').readOnly = !isAdm;
    document.getElementById('inpCliente').readOnly = !isAdm;
    document.getElementById('inpConductor').disabled = !isAdm;
    document.getElementById('secTarifa').style.display = isAdm ? 'block' : 'none';
    document.getElementById('btnAddProd').style.display = isAdm ? 'block' : 'none';

    const cont = document.getElementById('products-container');
    cont.innerHTML = '';
    if(item.lista_productos) {
        item.lista_productos.split('|').forEach(p => {
            let pts = p.split(':');
            if(pts[1]) {
                const div = document.createElement('div'); div.className = 'prod-row';
                div.innerHTML = `<input type="text" value="${pts[0].trim()}" readonly><input type="number" value="${parseFloat(pts[1])}" readonly>`;
                cont.appendChild(div);
            }
        });
    }
    calcularTotales();
};

window.prepararTiquete = (str) => {
    const item = JSON.parse(decodeURIComponent(str));
    
    const listaHtml = item.lista_productos 
        ? item.lista_productos.split('|').map(p => `<div style="margin-bottom:2px;">• ${p.trim()}</div>`).join('')
        : "<div>Sin productos registrados</div>";

    const tarifaVal = item.tarifa_comision || item.tarifa || 0;
    const obsVal = item.observacion || item.observaciones || "Sin observaciones";

    document.getElementById('printArea').innerHTML = `
        <div style="font-family:monospace; width:280px; color:black; padding:15px; border:1px solid #000; background:white; line-height:1.2; font-size:12px;">
            <center><h2 style="margin:0;">AGROLLANOS LOG</h2><p style="margin:5px 0; font-weight:bold;">ASIGNACIÓN DE CARGA</p></center>
            --------------------------<br>
            <strong>ID:</strong> ${item.id}<br>
            <strong>FECHA:</strong> ${item.fecha ? item.fecha.split('T')[0] : ''}<br>
            <strong>CONDUCTOR:</strong> ${item.conductor}<br>
            <strong>CLIENTE:</strong> ${item.cliente}<br>
            --------------------------<br>
            <strong>PRODUCTOS:</strong><br>${listaHtml}<br>
            --------------------------<br>
            <strong>TARIFA:</strong> $${Number(tarifaVal).toLocaleString()}<br>
            <strong>TOTAL KG:</strong> ${item.total_kg_entregado} kg<br>
            <strong>COMISIÓN:</strong> $${Number(item.total_comision).toLocaleString()}<br>
            --------------------------<br>
            <strong>OBSERVACIONES:</strong><br>
            <div style="font-style:italic; font-size:11px;">${obsVal}</div>
            --------------------------<br><br>
            <center>_____________________<br>FIRMA AUTORIZADA</center>
        </div>`;
    document.getElementById('printModal').style.display = 'flex';
};

window.verFoto = (path) => { Swal.fire({ imageUrl: path, imageWidth: 400, title: 'Evidencia de Entrega' }); };

async function borrarRegistro(id) {
    if ((await Swal.fire({ title: '¿Eliminar?', text: 'Esta acción es permanente', icon: 'warning', showCancelButton: true })).isConfirmed) {
        await fetch(`/api/despachos/${id}`, { method: 'DELETE' });
        loadData();
    }
}

function calcularTotales() {
    let t = 0, l = [];
    document.querySelectorAll('.prod-row').forEach(r => {
        const n = r.querySelector('input[type="text"]').value;
        const k = parseFloat(r.querySelector('input[type="number"]').value) || 0;
        if(n && k) { l.push(`${n}: ${k}kg`); t += k; }
    });
    document.getElementById('lblTotalSalida').textContent = t + ' kg';
    document.getElementById('inpTotalSalida').value = t;
    document.getElementById('listaProductosTexto').value = l.join(' | ');
    const kgE = parseFloat(document.getElementById('inpTotalEntregado').value) || 0;
    const tar = parseFloat(document.getElementById('inpTarifa').value) || 0;
    document.getElementById('outDevolucion').value = (t - kgE).toFixed(1) + ' kg';
    document.getElementById('outComision').textContent = '$' + Math.round(kgE * tar).toLocaleString();
}

window.descargarCSV = () => {
    let csv = "\uFEFFFecha;Conductor;Cliente;Kg;Comision;Estado\n";
    filteredData.forEach(i => csv += `${i.fecha.slice(0,10)};${i.conductor};${i.cliente};${i.total_kg_entregado};${i.total_comision};${i.estado}\n`);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = "Reporte_Agrollanos.csv"; link.click();
};

window.logout = () => { localStorage.removeItem('sidma_user'); location.reload(); };
window.verTab = (t) => { 
    document.getElementById('view-form').style.display = t==='form'?'block':'none'; 
    document.getElementById('view-list').style.display = t==='list'?'block':'none'; 
};
window.cambiarPagina = (d) => { if(currentPage+d > 0) { currentPage += d; renderTables(); } };
window.cerrarModal = () => document.getElementById('printModal').style.display = 'none';
window.agregarProducto = () => {
    const d = document.createElement('div'); d.className = 'prod-row';
    d.innerHTML = `<input type="text" placeholder="Producto" required><input type="number" placeholder="Kg" required><button type="button" onclick="this.parentElement.remove(); calcularTotales()">&times;</button>`;
    document.getElementById('products-container').appendChild(d);
};
function actualizarResumen() {
    let tk = 0, tm = 0; filteredData.forEach(i => { tk += parseFloat(i.total_kg_entregado)||0; tm += parseFloat(i.total_comision)||0; });
    document.getElementById('sumCount').textContent = filteredData.length;
    document.getElementById('sumKg').textContent = tk.toLocaleString();
    document.getElementById('sumMoney').textContent = '$' + tm.toLocaleString();
}
window.resetForm = () => { 
    document.getElementById('formDespacho').reset(); 
    document.getElementById('inpConductor').disabled = false; 
    document.getElementById('products-container').innerHTML = ''; 
    isEdit = false; 
};
