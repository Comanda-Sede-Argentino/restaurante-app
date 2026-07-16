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
  editarCategoria: (id, data) => req('/categorias/' + id, { method: 'PUT', body: data }),
  platos: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req('/platos' + (qs ? '?' + qs : ''));
  },
  platosFrecuentes: () => req('/platos/frecuentes'),
  setDisponible: (id, disponible) => req('/platos/' + id + '/disponible', { method: 'POST', body: { disponible } }),
  crearPlato: (data) => req('/platos', { method: 'POST', body: data }),
  editarPlato: (id, data) => req('/platos/' + id, { method: 'PUT', body: data }),
  borrarPlato: (id) => req('/platos/' + id, { method: 'DELETE' }),
  usuarios: () => req('/usuarios'),
  crearUsuario: (data) => req('/usuarios', { method: 'POST', body: data }),
  editarUsuario: (id, data) => req('/usuarios/' + id, { method: 'PUT', body: data }),
  borrarUsuario: (id) => req('/usuarios/' + id, { method: 'DELETE' }),
  mesas: () => req('/mesas'),
  pedidos: (estado) => req('/pedidos' + (estado ? '?estado=' + estado : '')),
  deliveryPendientes: () => req('/pedidos?pendienteEntrega=1'),
  entregar: (id, entregado = true) => req('/pedidos/' + id + '/entregar', { method: 'POST', body: { entregado } }),
  pedido: (id) => req('/pedidos/' + id),
  crearPedido: (data) => req('/pedidos', { method: 'POST', body: data }),
  actualizarPedido: (id, data) => req('/pedidos/' + id, { method: 'PUT', body: data }),
  agregarItems: (id, items) => req('/pedidos/' + id + '/items', { method: 'POST', body: { items } }),
  estadoItem: (id, estado) => req('/items/' + id + '/estado', { method: 'PUT', body: { estado } }),
  pagar: (id, pagos, extra = {}) => req('/pedidos/' + id + '/pagar', { method: 'POST', body: { pagos, ...extra } }),
  envio: (id, data) => req('/pedidos/' + id + '/envio', { method: 'POST', body: data }),
  // Cuentas corrientes (fiado)
  cuentas: () => req('/cuentas'),
  cuenta: (id) => req('/cuentas/' + id),
  crearCuenta: (data) => req('/cuentas', { method: 'POST', body: data }),
  editarCuenta: (id, data) => req('/cuentas/' + id, { method: 'PUT', body: data }),
  pagoCuenta: (id, data) => req('/cuentas/' + id + '/pago', { method: 'POST', body: data }),
  // Cierre de caja
  cajaResumen: () => req('/caja/resumen'),
  cajaCerrar: (data) => req('/caja/cerrar', { method: 'POST', body: data }),
  cajaCierres: () => req('/caja/cierres'),
  cajaCierreImprimir: (id) => req('/caja/cierres/' + id + '/imprimir', { method: 'POST' }),
  cajaMovimiento: (data) => req('/caja/movimiento', { method: 'POST', body: data }),
  reabrirPedido: (id) => req('/pedidos/' + id + '/reabrir', { method: 'POST' }),
  // Stock / inventario
  insumos: () => req('/insumos'),
  insumo: (id) => req('/insumos/' + id),
  crearInsumo: (data) => req('/insumos', { method: 'POST', body: data }),
  editarInsumo: (id, data) => req('/insumos/' + id, { method: 'PUT', body: data }),
  borrarInsumo: (id) => req('/insumos/' + id, { method: 'DELETE' }),
  comprarInsumo: (id, data) => req('/insumos/' + id + '/compra', { method: 'POST', body: data }),
  ajustarInsumo: (id, data) => req('/insumos/' + id + '/ajuste', { method: 'POST', body: data }),
  stockComprar: () => req('/stock/comprar'),
  recetaPlato: (id) => req('/platos/' + id + '/receta'),
  guardarReceta: (id, receta) => req('/platos/' + id + '/receta', { method: 'PUT', body: { receta } }),
  anular: (id, motivo) => req('/pedidos/' + id + '/anular', { method: 'POST', body: { motivo } }),
  moverPedido: (id, mesa_id) => req('/pedidos/' + id + '/mover', { method: 'POST', body: { mesa_id } }),
  unirPedido: (id, destino_pedido_id) => req('/pedidos/' + id + '/unir', { method: 'POST', body: { destino_pedido_id } }),
  kds: (sector) => req('/kds' + (sector ? '?sector=' + encodeURIComponent(sector) : '')),
  dashboard: () => req('/dashboard'),
  reportes: (desde, hasta, group) => req(`/reportes/general?desde=${desde}&hasta=${hasta}&group=${group}`),
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
  tgEstado: () => req('/telegram/estado'),
  tgConectar: () => req('/telegram/conectar', { method: 'POST' }),
  tgDesconectar: () => req('/telegram/desconectar', { method: 'POST' }),
};

export const socket = io({ autoConnect: true });

export const money = (n) =>
  '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
