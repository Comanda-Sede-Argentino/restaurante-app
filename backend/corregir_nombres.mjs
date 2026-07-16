// Corrige los nombres de los platos: ortografía/acentos + mayúsculas.
// Comida: "solo primera mayúscula". Bebidas/vinos: mantiene marcas con mayúscula.
// Uso:  node corregir_nombres.mjs           (solo PREVIEW, no toca nada)
//       node corregir_nombres.mjs --apply    (aplica los cambios)
import fs from 'fs';
const B = 'http://localhost:3001/api';
const APPLY = process.argv.includes('--apply');

const CONECT = new Set(['de', 'del', 'con', 'sin', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'u', 'a', 'al', 'por', 'para', 'en', 'un', 'una', 'x']);
// Palabras descriptivas (no son marcas): en bebidas también van en minúscula
const DESCR = new Set([
  'chico', 'chica', 'grande', 'mediano', 'mediana', 'medio', 'media', 'medida', 'lata', 'copa', 'jarra', 'jarrita', 'vaso', 'botella', 'pinta',
  'alcohol', 'gas', 'naranja', 'soda', 'gaseosa', 'dulce', 'natural', 'tinto', 'blanco', 'bco', 'negro', 'negra', 'roble', 'reserva',
  'leche', 'exprimido', 'jugo', 'agua', 'vino', 'cerveza', 'whisky', 'cafe', 'café', 'te', 'té', 'licor', 'trago', 'copetin', 'copetín',
  'clasico', 'clasica', 'clásica', 'especial', 'doble', 'triple', 'frozen', 'frozzen', 'oro', 'cream', 'light', 'zero', 'saborizada', 'sabori',
]);
// Acentos frecuentes (palabra en minúscula -> corregida)
const ACENTOS = {
  cafe: 'café', porcion: 'porción', jamon: 'jamón', salmon: 'salmón', mani: 'maní', anana: 'ananá',
  limon: 'limón', guarnicion: 'guarnición', clasica: 'clásica', albondigas: 'albóndigas', pure: 'puré',
  coleccion: 'colección', ingles: 'inglés', frances: 'francés', cordoba: 'córdoba', te: 'té',
  copetin: 'copetín', almibar: 'almíbar', budin: 'budín', tiramisu: 'tiramisú', menu: 'menú',
};
// Errores de tipeo claros (palabra en minúscula -> corregida)
const TYPO = {
  caball0: 'caballo', infaltil: 'infantil', brownnie: 'brownie', mojiot: 'mojito', merianda: 'merienda',
  totadas: 'tostadas', capuccino: 'capuchino', capucchino: 'capuchino', calabreza: 'calabresa',
  absolud: 'absolut', angu: 'angus', wiske: 'whisky', wisky: 'whisky', whiskyjohnnie: 'whisky johnnie',
  jhonnie: 'johnnie', jhonny: 'johnnie', johnni: 'johnnie', johnny: 'johnnie', jonnie: 'johnnie',
  jagermaifter: 'jägermeister', chardonay: 'chardonnay', cavernet: 'cabernet', carbernet: 'cabernet',
  fugazzetta: 'fugazzeta', ruttini: 'rutini', redbull: 'red bull', escoces: 'escocés',
};
const cap = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);
const corregir = (w) => { const l = w.toLowerCase(); return TYPO[l] || ACENTOS[l] || w; };

function nuevoNombre(nombre, esBebida) {
  // Expandir abreviaturas
  let s = nombre.replace(/\bC\//gi, 'con ').replace(/\bS\//gi, 'sin ').replace(/\bP\//gi, 'para ');
  s = s.replace(/\s+/g, ' ').trim();
  let words = s.split(' ').flatMap((w) => corregir(w).split(' '));
  if (esBebida) {
    // Mantener marcas: bajar solo conectores, capitalizar el resto; primera siempre mayúscula
    words = words.map((w, i) => {
      const l = w.toLowerCase();
      if (i > 0 && (CONECT.has(l) || DESCR.has(l))) return l;
      return /[a-záéíóúñü]/i.test(w) ? cap(w) : w;
    });
  } else {
    // Comida: primera palabra mayúscula, resto minúscula
    words = words.map((w, i) => (i === 0 ? cap(w.toLowerCase()) : w.toLowerCase()));
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

const esBebidaCat = (cat) => /bebida|cafeter/i.test(cat || '');

async function main() {
  const platos = await (await fetch(B + '/platos?todos=1')).json();
  const cambios = [];
  for (const p of platos) {
    const nuevo = nuevoNombre(p.nombre, esBebidaCat(p.categoria));
    if (nuevo && nuevo !== p.nombre) cambios.push({ id: p.id, viejo: p.nombre, nuevo });
  }
  cambios.sort((a, b) => a.viejo.localeCompare(b.viejo));
  const txt = cambios.map((c) => `${c.viejo}   →   ${c.nuevo}`).join('\n');
  fs.writeFileSync('_nombres_preview.txt', txt, 'utf8');
  console.log(`Total platos: ${platos.length} | Cambian: ${cambios.length}\n`);
  console.log('--- MUESTRA (primeros 60) ---');
  console.log(cambios.slice(0, 60).map((c) => `${c.viejo}  →  ${c.nuevo}`).join('\n'));
  console.log(`\n(La lista COMPLETA quedó en backend\\_nombres_preview.txt)`);
  if (APPLY) {
    // Backup de seguridad de la base antes de tocar nada
    try { await fetch(B + '/backup', { method: 'POST' }); console.log('🛟 Backup de la base hecho.'); } catch {}
    for (const c of cambios) {
      await fetch(B + '/platos/' + c.id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre: c.nuevo }) });
    }
    console.log(`\n✅ APLICADOS ${cambios.length} cambios.`);
  } else {
    console.log('\n(PREVIEW: no se cambió nada. Para aplicar: --apply)');
  }
  process.exit(0);
}
main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
