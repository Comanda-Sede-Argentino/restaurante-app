import { useEffect, useState, useMemo } from 'react';
import { api, money } from '../api';
import { toast } from '../ui.jsx';

export default function Admin() {
  const [cats, setCats] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [catSel, setCatSel] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);

  const cargar = () => api.platos({ todos: 1, ...(catSel ? { categoria: catSel } : {}) }).then(setPlatos);
  useEffect(() => {
    api.categorias().then(setCats);
    api.sectores().then(setSectores);
    api.insumos().then(setInsumos).catch(() => {});
  }, []);
  useEffect(() => { cargar(); }, [catSel]);

  const filtrados = useMemo(() => {
    if (!q) return platos;
    return platos.filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase()));
  }, [platos, q]);

  const [verCats, setVerCats] = useState(false);
  const [verComanda, setVerComanda] = useState(false);

  // Abrir edición cargando la receta completa (insumos que descuenta del stock)
  const abrirEdit = async (p) => {
    let receta = [];
    if (p.id) {
      try { receta = (await api.recetaPlato(p.id)).map((r) => ({ insumo_id: String(r.insumo_id), cantidad: r.cantidad })); }
      catch { /* sin receta */ }
    }
    setEdit({ ...p, receta });
  };

  const setRecetaRow = (i, campo, val) => setEdit((e) => ({ ...e, receta: e.receta.map((r, j) => (j === i ? { ...r, [campo]: val } : r)) }));
  const addReceta = () => setEdit((e) => ({ ...e, receta: [...(e.receta || []), { insumo_id: '', cantidad: 1 }] }));
  const delReceta = (i) => setEdit((e) => ({ ...e, receta: e.receta.filter((_, j) => j !== i) }));

  const guardar = async () => {
    const data = {
      nombre: edit.nombre,
      categoria_id: Number(edit.categoria_id),
      sector_id: Number(edit.sector_id),
      precio: Number(edit.precio),
      activo: edit.activo ? 1 : 0,
      alias_ia: edit.alias_ia || '',
      punto: edit.punto ? 1 : 0,
    };
    const id = edit.id ? (await api.editarPlato(edit.id, data), edit.id) : (await api.crearPlato(data)).id;
    // Guardar la receta (qué insumos descuenta del stock)
    try {
      const receta = (edit.receta || [])
        .filter((r) => r.insumo_id && Number(r.cantidad) > 0)
        .map((r) => ({ insumo_id: Number(r.insumo_id), cantidad: Number(r.cantidad) }));
      await api.guardarReceta(id, receta);
    } catch { /* el backend puede no tener stock aún */ }
    setEdit(null); cargar();
  };

  const toggleFavorito = async (p) => {
    const nuevo = p.favorito ? 0 : 1;
    setPlatos((prev) => prev.map((x) => (x.id === p.id ? { ...x, favorito: nuevo } : x)));
    try {
      await api.editarPlato(p.id, { favorito: nuevo });
    } catch (e) {
      setPlatos((prev) => prev.map((x) => (x.id === p.id ? { ...x, favorito: p.favorito } : x)));
      toast('No se pudo guardar el favorito. ' + e.message, 'error');
    }
  };

  const toggleGuarnicion = async (c) => {
    const nuevo = c.guarnicion ? 0 : 1;
    // Optimista: marcamos el ✓ al instante para que se sienta inmediato.
    setCats((prev) => prev.map((x) => (x.id === c.id ? { ...x, guarnicion: nuevo } : x)));
    try {
      await api.editarCategoria(c.id, { guarnicion: nuevo });
    } catch (e) {
      // Si falla (ej. esta PC tiene una versión vieja del sistema), revertimos y avisamos.
      setCats((prev) => prev.map((x) => (x.id === c.id ? { ...x, guarnicion: c.guarnicion } : x)));
      toast('No se pudo guardar la guarnición. Revisá que esta PC tenga la última actualización.', 'error');
    }
  };

  // Checkbox = "no sale en la comanda de cocina" (bebidas). Marcado => en_comanda 0.
  const toggleExcluirComanda = async (c) => {
    const actual = c.en_comanda === 0; // ¿ya está excluida?
    const nuevoEnComanda = actual ? 1 : 0;
    setCats((prev) => prev.map((x) => (x.id === c.id ? { ...x, en_comanda: nuevoEnComanda } : x)));
    try {
      await api.editarCategoria(c.id, { en_comanda: nuevoEnComanda });
    } catch (e) {
      setCats((prev) => prev.map((x) => (x.id === c.id ? { ...x, en_comanda: c.en_comanda } : x)));
      toast('No se pudo guardar. Revisá que esta PC tenga la última actualización.', 'error');
    }
  };

  const nuevo = () =>
    setEdit({ nombre: '', categoria_id: cats[0]?.id, sector_id: sectores[0]?.id, precio: 0, activo: 1, alias_ia: '', punto: 0, receta: [] });

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
          <div style={{ marginTop: 10 }}>
            <label className="h2" style={{ display: 'block', marginBottom: 4 }}>Alias para el bot (IA) — opcional</label>
            <input value={edit.alias_ia || ''} onChange={(e) => setEdit({ ...edit, alias_ia: e.target.value })}
              placeholder="Ej. en Pizza Especial: napolitana, roquefort, fugazzeta, muzzarella..."
              style={{ width: '100%' }} />
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
              Otras formas en que el cliente puede nombrar este plato. La IA del bot lo usa para no confundirse
              y manda la variedad como aclaración a la cocina. Separá con comas.
            </p>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={!!edit.punto} onChange={(e) => setEdit({ ...edit, punto: e.target.checked ? 1 : 0 })} />
              🔥 Pedir punto de cocción (bife, entrecot...)
            </label>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
              Si lo activás, al cargar el pedido vas a poder elegir <b>el punto de cada unidad</b> (jugoso / a punto / cocido) por separado.
            </p>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="h2" style={{ display: 'block', marginBottom: 4 }}>🧾 Receta — descuenta del stock (opcional)</label>
            {!insumos.length && <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Primero cargá insumos en la pantalla Stock.</p>}
            {insumos.length > 0 && (
              <>
                {(edit.receta || []).map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                    <select value={r.insumo_id} onChange={(e) => setRecetaRow(i, 'insumo_id', e.target.value)} style={{ flex: 1, minWidth: 160 }}>
                      <option value="">— elegir insumo —</option>
                      {insumos.map((ins) => <option key={ins.id} value={ins.id}>{ins.nombre} ({ins.unidad})</option>)}
                    </select>
                    <input type="number" step="0.01" value={r.cantidad} onChange={(e) => setRecetaRow(i, 'cantidad', e.target.value)} style={{ width: 90 }} placeholder="cant." />
                    <button className="btn-red" onClick={() => delReceta(i)}>✕</button>
                  </div>
                ))}
                <button onClick={addReceta}>+ Agregar insumo</button>
              </>
            )}
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
              <b>Bebidas:</b> 1 insumo, cantidad <b>1</b> (cada venta descuenta 1). <b>Comida:</b> agregá cada ingrediente
              con su cantidad por porción (ej. 0,2 kg carne + 0,05 kg queso). Sin filas = no controla stock.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-green" onClick={guardar}>Guardar</button>
            <button onClick={() => setEdit(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>🍟 Categorías con guarnición incluida</h2>
          <span className="spacer" />
          <button onClick={() => setVerCats((v) => !v)}>{verCats ? 'Ocultar' : 'Configurar'}</button>
        </div>
        {verCats && (
          <>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Marcá las categorías cuyos platos vienen con guarnición (milanesas, carnes, pollo, etc.).
              Si el cliente no aclara, el bot la pone por defecto; si la pide sin guarnición, lo avisa a la cocina.
            </p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 6 }}>
              {cats.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <input type="checkbox" checked={!!c.guarnicion} onChange={() => toggleGuarnicion(c)} />
                  {c.nombre}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>🥤 Categorías que NO salen en la comanda de cocina</h2>
          <span className="spacer" />
          <button onClick={() => setVerComanda((v) => !v)}>{verComanda ? 'Ocultar' : 'Configurar'}</button>
        </div>
        {verComanda && (
          <>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Marcá las categorías que <b>no querés que aparezcan</b> en la comanda que va a la cocina
              (típicamente las bebidas: el mozo las sirve y la cocina no las necesita). Igual se cobran y figuran en la cuenta.
            </p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 6 }}>
              {cats.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <input type="checkbox" checked={c.en_comanda === 0} onChange={() => toggleExcluirComanda(c)} />
                  {c.nombre}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <table>
          <thead><tr><th title="A mano para el mozo">⭐</th><th>Plato</th><th>Categoría</th><th>Sector</th><th>Precio</th><th></th></tr></thead>
          <tbody>
            {filtrados.slice(0, 400).map((p) => (
              <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.4 }}>
                <td style={{ textAlign: 'center', cursor: 'pointer', fontSize: 18 }}
                  title={p.favorito ? 'Quitar de favoritos' : 'Marcar como favorito (lo ve el mozo primero)'}
                  onClick={() => toggleFavorito(p)}>{p.favorito ? '⭐' : '☆'}</td>
                <td>{p.nombre}</td>
                <td>{p.categoria}</td>
                <td>{p.sector}</td>
                <td style={{ color: 'var(--accent)' }}>{money(p.precio)} {p.revisar_precio ? '⚠' : ''}</td>
                <td><button onClick={() => abrirEdit(p)}>✏</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtrados.length > 400 && <p style={{ color: 'var(--muted)' }}>Mostrando 400 de {filtrados.length}. Filtrá para ver más.</p>}
      </div>
    </div>
  );
}
