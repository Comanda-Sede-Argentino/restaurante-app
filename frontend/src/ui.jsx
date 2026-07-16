// Avisos (toast) y diálogos (confirmar / preguntar) propios, sin los pop-ups del navegador.
import { useEffect, useState } from 'react';

let _toast = () => {};
let _dialog = () => {};

// toast(mensaje, tipo)  tipo: 'ok' | 'error' | 'info'
export function toast(mensaje, tipo = 'ok') { _toast({ mensaje, tipo }); }
// confirmar(mensaje) -> Promise<boolean>
export function confirmar(mensaje, opts = {}) {
  return new Promise((resolve) => _dialog({ tipo: 'confirm', mensaje, ok: opts.ok || 'Sí', cancelar: opts.cancelar || 'No', peligro: !!opts.peligro, resolve }));
}
// preguntar(mensaje, valorInicial) -> Promise<string|null>
export function preguntar(mensaje, valor = '', opts = {}) {
  return new Promise((resolve) => _dialog({ tipo: 'prompt', mensaje, valor, placeholder: opts.placeholder || '', resolve }));
}

export function UiHost() {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    _toast = (t) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((ts) => [...ts, { ...t, id }]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3600);
    };
    _dialog = (d) => { setInput(d.valor || ''); setDialog(d); };
    return () => { _toast = () => {}; _dialog = () => {}; };
  }, []);

  const cerrar = (val) => { const d = dialog; setDialog(null); d?.resolve(val); };

  return (
    <>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.tipo}>{t.mensaje}</div>
        ))}
      </div>
      {dialog && (
        <div className="modal-backdrop" onClick={() => cerrar(dialog.tipo === 'confirm' ? false : null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-msg">{dialog.mensaje}</div>
            {dialog.tipo === 'prompt' && (
              <input autoFocus value={input} placeholder={dialog.placeholder}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') cerrar(input); if (e.key === 'Escape') cerrar(null); }}
                style={{ width: '100%', marginTop: 12, fontSize: 16 }} />
            )}
            <div className="modal-actions">
              {dialog.tipo === 'confirm' ? (
                <>
                  <button onClick={() => cerrar(false)}>{dialog.cancelar}</button>
                  <button className={dialog.peligro ? 'btn-red' : 'btn-green'} onClick={() => cerrar(true)}>{dialog.ok}</button>
                </>
              ) : (
                <>
                  <button onClick={() => cerrar(null)}>Cancelar</button>
                  <button className="btn-green" onClick={() => cerrar(input)}>Aceptar</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
