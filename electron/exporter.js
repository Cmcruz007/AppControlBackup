const fs = require('fs');
const path = require('path');

function guardarDatosParaElMovil(datos) {
    const jsonPath = 'C:\\Users\\Public\\backup_status.json';
    try {
        fs.writeFileSync(jsonPath, JSON.stringify(datos, null, 4), 'utf8');
        return true;
    } catch (error) {
        console.error("Error en exportador:", error);
        return false;
    }
}

module.exports = { guardarDatosParaElMovil };