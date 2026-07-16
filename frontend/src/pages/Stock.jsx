import { useEffect, useState } from 'react';
import { api, money } from '../api';
import { toast, confirmar } from '../ui.jsx';

const UNIDADES = ['unidad', 'kg', 'gramo', 'litro', 'ml', 'docena', 'paquete', 'caja', 'botella'];
const numAR = (s) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;

export default function Stock() {
  const [insumos, setInsumos] = useState([]);
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState(null);   // insumo en edición/creación
  const [accion, setAccion] = useState(null); // { tipo:'compra'|'ajuste', insumo, valor }

  const cargar = () => api.insumos().then(setInsumos);
  useEffect(() => { cargar(); }, []);

  const faltantes = insumos.filter((i) => i.falta);

  const aviso = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const guardar = async () => {
    const data = {
      nombre: edit.nombre, unidad: edit.unidad || 'unidad',
      stock_minimo: numAR(edit.stock_minimo), costo: numAR(edit.costo), proveedor: edit.proveedor || '',
    };
    if (edit.id) await api.editarInsumo(edit.id, data);
    else { data.stock = numAR(edit.stock); await api.crearInsumo(data); }
    setEdit(null); aviso('✅ Guardado.'); cargar();
  };

  const confirmarAccion = async () => {
    const v = numAR(accion.valor);
    if (accion.tipo === 'compra') {
      if (!(v > 0)) { toast('Cantidad inválida', 'error'); return; }
      await api.comprarInsumo(accion.insumo.id, { cantidad: v });
    } else {
      await api.ajustarInsumo(accion.insumo.id, { stock_real: v });
    }
    setAccion(null); aviso('✅ Stock actualizado.'); cargar();
  };

  const borrar = async (i) => {
    if (!(await confirmar(`¿Borrar el insumo "${i.nombre}"?`, { peligro: true, ok: 'Borrar' }))) return;
    await api.borrarInsumo(i.id); cargar();
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>📦 Stock / Inventario</h1>
        <span className="spacer" />
        <button className="btn-accent" onClick={() => setEdit({ nombre: '', unidad: 'unidad', stock: 0, stock_minimo: 0, costo: 0, proveedor: '' })}>+ Nuevo insumo</button>
      </div>
      {msg && <div className="card" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>{msg}</div>}

      {/* Para comprar */}
      <div className="card" style={{ marginBottom: 14, borderColor: faltantes.length ? 'var(--orange)' : '' }}>
        <h2 className="h2" style={{ marginTop: 0 }}>🛒 Para comprar {faltantes.length ? `(${faltantes.length})` : ''}</h2>
        {!faltantes.length && <p style={{ color: 'var(--muted)', margin: 0 }}>Todo OK, nada por debajo del mínimo. 🎉</p>}
        {faltantes.map((i) => (
          <div key={i.id} className="cart-item" style={{ color: 'var(--orange)' }}>
            <span style={{ flex: 1 }}>{i.nombre}</span>
            <span>quedan <b>{i.stock} {i.unidad}</b> (mín. {i.stock_minimo})</span>
          </div>
        ))}
      </div>

      {/* Form alta/edición */}
      {edit && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
          <h2 className="h2">{edit.id ? 'Editar' : 'Nuevo'} insumo</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
            <input placeholder="Nombre" value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} />
            <select value={edit.unidad} onChange={(e) => setEdit({ ...edit, unidad: e.target.value })}>
              {UNIDADES.map((u) => <option key={u}>{u}</option>)}
            </select>
            {!edit.id && <input placeholder="Stock inicial" value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: e.target.value })} />}
            <input placeholder="Stock mínimo (alerta)" value={edit.stock_minimo} onChange={(e) => setEdit({ ...edit, stock_minimo: e.target.value })} />
            <input placeholder="Costo unitario" value={edit.costo} onChange={(e) => setEdit({ ...edit, costo: e.target.value })} />
            <input placeholder="Proveedor (opcional)" value={edit.proveedor} onChange={(e) => setEdit({ ...edit, proveedor: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-green" onClick={guardar}>Guardar</button>
            <button onClick={() => setEdit(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Modal acción compra/ajuste */}
      {accion && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
          <h2 className="h2">{accion.tipo === 'compra' ? '➕ Registrar compra' : '✏️ Ajustar stock (recuento)'} — {accion.insumo.nombre}</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
            {accion.tipo === 'compra'
              ? `Cuánto SUMÁS al stock (en ${accion.insumo.unidad}). Stock actual: ${accion.insumo.stock}.`
              : `Poné el stock REAL que contaste (en ${accion.insumo.unidad}). El sistema corrige la diferencia.`}
          </p>
          <input autoFocus placeholder={accion.tipo === 'compra' ? 'Cantidad a sumar' : 'Stock real contado'}
            value={accion.valor} onChange={(e) => setAccion({ ...accion, valor: e.target.value })} style={{ width: 200 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-green" onClick={confirmarAccion}>Confirmar</button>
            <button onClick={() => setAccion(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Tabla de insumos */}
      <div className="card">
        {!insumos.length && <p style={{ color: 'var(--muted)' }}>No hay insumos cargados. Creá el primero con "+ Nuevo insumo".</p>}
        {insumos.length > 0 && (
          <table style={{ width: '100%' }}>
            <thead><tr><th>Insumo</th><th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>Mínimo</th><th></th></tr></thead>
            <tbody>
              {insumos.map((i) => (
                <tr key={i.id} style={{ background: i.falta ? 'rgba(229,72,77,0.12)' : '' }}>
                  <td>{i.nombre} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({i.unidad})</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: i.falta ? 'var(--orange)' : '' }}>{i.stock}</td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{i.stock_minimo}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button title="Registrar compra" onClick={() => setAccion({ tipo: 'compra', insumo: i, valor: '' })}>➕ Compra</button>{' '}
                    <button title="Ajustar (recuento)" onClick={() => setAccion({ tipo: 'ajuste', insumo: i, valor: String(i.stock) })}>✏️</button>{' '}
                    <button title="Editar" onClick={() => setEdit({ ...i })}>⚙</button>{' '}
                    <button title="Borrar" onClick={() => borrar(i)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
