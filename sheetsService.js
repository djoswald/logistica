// sheetsService.js
// ASEGÚRATE DE QUE SCRIPT_URL SIGA SIENDO TU URL DE GOOGLE APPS SCRIPT
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby4MW9Tym1k4DysXhhs58fqG6iuRw6qeKNjXT6zfn0CkFFdZosh5-9bIAq8fXdWY3BG/exec'; // <-- VERIFICA ESTO

async function request(action, sheetName, data = {}, id = null) {
    try {
        const payload = { action, sheet: sheetName, data: JSON.stringify(data) };
        if (id) payload.id = id;

        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            redirect: "follow",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error("Error Sheets:", error);
        return { error: error.message };
    }
}

module.exports = {
    readSheet: (sheet) => request('read', sheet),
    appendRow: (sheet, data) => request('create', sheet, data),
    updateRow: (sheet, id, data) => request('update', sheet, data, id), // Nueva función
    deleteRow: (sheet, id) => request('delete', sheet, {}, id)          // Nueva función
};