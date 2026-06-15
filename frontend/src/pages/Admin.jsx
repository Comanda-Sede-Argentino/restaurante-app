import { useEffect, useState, useMemo } from 'react';
import { api, money } from '../api';

export default function Admin() {
  const [cats, setCats] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [catSel, setCatSel] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);

  const cargar = () => api.platos({ todos: 1, ...(catSel ? { categoria: catSel } : {}) }).then(setPlatos);
  useEffect(() => {
    api.categorias().then(setCats);
    api.sectores().then(setSectores);
  }, []);
  useEffect(() => { cargar(); }, [catSel]);

  const filtrados = useMemo(() => {
    if (!q) return platos;
    return platos.filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase()));
  }, [platos, q]);

  const guardar = async () => {
    const data = {
      nombre: edit.nombre,
      categoria_id: Number(edit.categoria_id),
      sector_id: Number(edit.sector_id),
      precio: Number(edit.precio),
      activo: edit.activo ? 1 : 0,
    };
    if (edit.id) await api.editarPlato(edit.id, data);
    else await api.crearPlato(data);
    setEdit(null); cargar();
  };

  const nuevo = () =>
    setEdit({ nombre: '', categoria_id: cats[0]?.id, sector_id: sectores[0]?.id, precio: 0, activo: 1 });

  const revisar = platos.filter((p) => p.revisar_precio).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>Catálogo de platos</h1>
        <span className="spacer" />
        <button className="btn-accent" onClick={nuevo}>+ Nuevo plato</button>
      </div>
      {revisar > 0 && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--orange)' }}>
          ⚠ {platos.length} platos importados del sistema anterior. Los precios son estimados —
          revisalos/ajustalos (o completá la migración exacta del MDF en la Fase 0).
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={catSel} onChange={(e) => setCatSel(e.target.value)}>
          <option value="">Todas las categorías</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <input placeholder="🔎 Buscar..." value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>

      {edit && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
          <h2 className="h2">{edit.id ? 'Editar' : 'Nuevo'} plato</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
            <input placeholder="Nombre" value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} />
            <select value={edit.categoria_id} onChange={(e) => setEdit({ ...edit, categoria_id: e.target.value })}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={edit.sector_id} onChange={(e) => setEdit({ ...edit, sector_id: e.target.value })}>
              {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <input type="number" placeholder="Precio" value={edit.precio} onChange={(e) => setEdit({ ...edit, precio: e.target.value })} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!!edit.activo} onChange={(e) => setEdit({ ...edit, activo: e.target.checked })} /> Activo
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-green" onClick={guardar}>Guardar</button>
            <button onClick={() => setEdit(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="card">
        <table>
          <thead><tr><th>Plato</th><th>Categoría</th><th>Sector</th><th>Precio</th><th>Ventas hist.</th><th></th></tr></thead>
          <tbody>
            {filtrados.slice(0, 400).map((p) => (
              <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.4 }}>
                <td>{p.nombre}</td>
                <td>{p.categoria}</td>
                <td>{p.sector}</td>
                <td style={{ color: 'var(--accent)' }}>{money(p.precio)} {p.revisar_precio ? '⚠' : ''}</td>
                <td>{p.ventas_historicas}</td>
                <td><button onClick={() => setEdit({ ...p })}>✏</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtrados.length > 400 && <p style={{ color: 'var(--muted)' }}>Mostrando 400 de {filtrados.length}. Filtrá para ver más.</p>}
      </div>
    </div>
  );
}
