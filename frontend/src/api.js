import { io } from 'socket.io-client';

const base = '/api';

async function req(path, opts = {}) {
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error('Error ' + res.status);
  return res.json();
}

export const api = {
  sectores: () => req('/sectores'),
  categorias: () => req('/categorias'),
  platos: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req('/platos' + (qs ? '?' + qs : ''));
  },
  crearPlato: (data) => req('/platos', { method: 'POST', body: data }),
  editarPlato: (id, data) => req('/platos/' + id, { method: 'PUT', body: data }),
  borrarPlato: (id) => req('/platos/' + id, { method: 'DELETE' }),
  usuarios: () => req('/usuarios'),
  mesas: () => req('/mesas'),
  pedidos: (estado) => req('/pedidos' + (estado ? '?estado=' + estado : '')),
  pedido: (id) => req('/pedidos/' + id),
  crearPedido: (data) => req('/pedidos', { method: 'POST', body: data }),
  actualizarPedido: (id, data) => req('/pedidos/' + id, { method: 'PUT', body: data }),
  agregarItems: (id, items) => req('/pedidos/' + id + '/items', { method: 'POST', body: { items } }),
  estadoItem: (id, estado) => req('/items/' + id + '/estado', { method: 'PUT', body: { estado } }),
  pagar: (id, pagos) => req('/pedidos/' + id + '/pagar', { method: 'POST', body: { pagos } }),
  anular: (id) => req('/pedidos/' + id + '/anular', { method: 'POST' }),
  kds: (sector) => req('/kds' + (sector ? '?sector=' + encodeURIComponent(sector) : '')),
  dashboard: () => req('/dashboard'),
  reimprimir: (id) => req('/pedidos/' + id + '/reimprimir', { method: 'POST' }),
  imprimirCuenta: (id) => req('/pedidos/' + id + '/cuenta', { method: 'POST' }),
  impresoras: () => req('/impresoras'),
  puertosCom: () => req('/puertos-com'),
  config: () => req('/config'),
  guardarConfig: (data) => req('/config', { method: 'PUT', body: data }),
  testImpresora: (impresora) => req('/impresoras/test', { method: 'POST', body: { impresora } }),
  waEstado: () => req('/whatsapp/estado'),
  waConectar: () => req('/whatsapp/conectar', { method: 'POST' }),
  waDesconectar: () => req('/whatsapp/desconectar', { method: 'POST' }),
  waInbox: (estado = 'pendiente') => req('/whatsapp/inbox?estado=' + estado),
  waConvertir: (id) => req('/whatsapp/inbox/' + id + '/convertir', { method: 'POST' }),
  waDescartar: (id) => req('/whatsapp/inbox/' + id + '/descartar', { method: 'POST' }),
  waResponder: (destino, texto) => req('/whatsapp/responder', { method: 'POST', body: { destino, texto } }),
};

export const socket = io({ autoConnect: true });

export const money = (n) =>
  '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
