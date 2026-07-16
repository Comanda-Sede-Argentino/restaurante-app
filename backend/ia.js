// Interpreta un pedido en lenguaje natural usando Claude (Anthropic).
// Devuelve el pedido estructurado, matcheando los platos contra el menú real.
// Usa "tool use" para forzar una salida JSON validada.

const HERRAMIENTA = {
  name: 'registrar_pedido',
  description: 'Registra un pedido de delivery interpretado del mensaje del cliente.',
  input_schema: {
    type: 'object',
    properties: {
      cliente_nombre: { type: 'string', description: 'Nombre del cliente si lo menciona; si no, vacío' },
      direccion: { type: 'string', description: 'Dirección de entrega si la menciona; si no, vacío' },
      telefono: { type: 'string', description: 'Teléfono si lo menciona; si no, vacío' },
      hora_entrega: { type: 'string', description: 'Hora de entrega pedida en formato HH:MM si la menciona; si no, vacío' },
      items: {
        type: 'array',
        description: 'Lista de platos pedidos',
        items: {
          type: 'object',
          properties: {
            plato_id: { type: 'integer', description: 'ID del plato del menú que mejor coincide' },
            cantidad: { type: 'integer', description: 'Cantidad pedida' },
            observacion: { type: 'string', description: 'Aclaración del ítem, ej. "sin sal" (vacío si no hay)' },
            precio_unit: { type: 'integer', description: 'Precio POR UNIDAD, SOLO si el mensaje lo indica para este ítem (ej. "lomito a 20000" -> 20000). Si el mensaje no da precio, NO incluyas este campo (se usa el del sistema).' },
          },
          required: ['plato_id', 'cantidad'],
        },
      },
      items_libres: {
        type: 'array',
        description: 'Cosas que el cliente pidió que NO están en el menú pero igual hay que ANOTAR en la comanda para que la cocina las prepare (ej. "tarta de jamón y queso", "arroz con atún y palta"). NO las descartes: van acá.',
        items: {
          type: 'object',
          properties: {
            nombre: { type: 'string', description: 'Lo que pidió, prolijo (ej. "Tarta de jamón y queso")' },
            cantidad: { type: 'integer', description: 'Cantidad pedida (1 si no aclara)' },
            precio_unit: { type: 'integer', description: 'Precio por unidad SOLO si el mensaje lo indica; si no, NO lo pongas' },
          },
          required: ['nombre', 'cantidad'],
        },
      },
      no_reconocidos: {
        type: 'array',
        description: 'Solo cosas que NO son un pedido de comida (ej. un saludo suelto). La comida fuera de carta va en items_libres, NO acá.',
        items: { type: 'string' },
      },
      es_envio: {
        type: 'boolean',
        description: 'true si hay que LLEVAR el pedido a una dirección (delivery). false si el cliente lo RETIRA / pasa a buscar.',
      },
      nota: { type: 'string', description: 'Aclaración general del pedido si la hay' },
    },
    required: ['items', 'es_envio'],
  },
};

const SISTEMA = `Sos un asistente que interpreta pedidos de delivery de un restaurante argentino.
Te paso el MENU y el MENSAJE del cliente. Devolvé el pedido usando la herramienta registrar_pedido.

Cada línea del MENU es: "id: nombre ($precio)" y puede tener marcas:
- "[alias: ...]" = otras formas en que el cliente puede nombrar ese plato (variedades, sinónimos).
- "[guarnición]" = ese plato viene CON guarnición incluida.

REGLAS DE MATCH (importante):
- Para cada ítem elegí el plato del MENU que coincida por nombre o por sus alias, ignorando
  acentos y mayúsculas ("napo" = "napolitana").
- NOMBRE BASE (MUY IMPORTANTE): si el cliente dice un nombre genérico ("lomito", "milanesa",
  "barroluco", "bife de chorizo"), elegí SIEMPRE el plato con ese nombre EXACTO/base ("Lomito",
  "Milanesa", "Bife de chorizo"), NUNCA una variante más específica ("Lomito especial",
  "Bife de chorizo con salsa", "Lomito de pollo") salvo que el cliente lo pida con esas palabras.
  Ej: "3 bifes de chorizo" = "Bife de chorizo" (NO "Bife de chorizo con salsa").
- Si un genérico NO tiene un plato con ese nombre exacto pero hay una variante "común/clásica",
  usá esa como default. EN PARTICULAR: "milanesa" sola (sin aclarar tipo) = "Milanesa ternera".
- Los ALIAS son clave: si el cliente pide algo que coincide con un alias, usá ESE plato y poné
  lo específico que pidió en la "observacion". Ej: si "Pizza Especial" tiene alias "napolitana,
  roquefort", y piden "pizza napolitana", devolvé Pizza Especial con observacion "napolitana".
- SOLO asigná un plato del menú si estás razonablemente seguro. Si piden algo que NO está en el menú
  ni en los alias (ej. "tarta de jamón y queso", "arroz con atún y palta", "flan casero"), NO lo
  reemplaces por otro parecido y NO lo descartes: ponelo en "items_libres" (con su nombre prolijo, la
  cantidad, y el precio si el mensaje lo dice). Así igual sale en la comanda para la cocina.
- NO FUERCES coincidencias por parecido de palabras. Si el nombre NO corresponde EXACTAMENTE a un plato
  del menú, va a items_libres aunque comparta alguna palabra. OJO ESPECIAL con las carnes:
  · "bife de lomo" NO es "Lomito" (eso es un sándwich) ni "Bife de chorizo" ni "Bife de pechuga"
    (son OTROS cortes distintos). Si "bife de lomo" no está en el menú -> va a items_libres.
  · un corte o plato que no figura TAL CUAL en la carta -> items_libres, NO el más parecido.
  Ante la duda de si está o no en el menú, elegí items_libres (es mejor eso que matchear mal).
- Reservá "no_reconocidos" SOLO para cosas que no son comida (ej. un saludo). La comida que no está
  en la carta va SIEMPRE en items_libres.
- REGLA DE ORO: NUNCA omitas algo que el cliente pidió. CADA ítem pedido tiene que aparecer sí o sí,
  o en "items" (si está en el menú, ej. "milanesa de pollo" = "Milanesa de pollo") o en "items_libres"
  (si no está, ej. "bife de lomo"). Nunca lo dejes afuera. Contá: la cantidad de cosas que pidió el
  cliente = items + items_libres.

PORCIONES Y MITADES (con cuidado):
- MEDIA PORCIÓN: "medio X" o "1/2 X" = usá la variante de MEDIA PORCIÓN del menú ("X 1/2" o
  "1/2 X") si existe. Ej: "1/2 lomito" -> el plato "Lomito 1/2".
- "un X y medio" / "1 X y 1/2" = DOS ítems separados: 1 de "X" entero + 1 de "X 1/2".
  Ej: "1 lomito y 1/2" -> 1 "Lomito" + 1 "Lomito 1/2".
- PIZZA MITAD Y MITAD (dos variedades en una pizza): "1/2 napolitana y 1/2 roquefort" = UNA sola
  pizza, con observacion "mitad napolitana, mitad roquefort" (NO dos ítems).

ENVÍO O RETIRO (devolvé SIEMPRE es_envio, true o false):
- POR DEFECTO es_envio = true: los pedidos del bot son de DELIVERY, así que se cobra envío.
- es_envio = true si hay que LLEVARLO a una dirección ("llevar a...", "enviar a...", "mandar a...",
  "a domicilio"), si da una dirección, o si NO aclara nada sobre retiro.
- es_envio = false SOLO si el cliente dice claramente que lo RETIRA o lo pasa a buscar:
  "retiro", "para retirar", "lo retiro", "paso a buscar", "lo busco", "lo paso a buscar", "lo retira".

OBSERVACIONES Y GUARNICIÓN — regla simple (la guarnición por defecto NO se aclara):
- Poné en "observacion" SOLO lo que el cliente aclara y que se aparta de lo habitual:
  ej. "sin sal", "sin tomate", "sin papas", "con puré", "con ensalada", "con huevo", "poca mayonesa".
- Poné TODO lo que aclara, COMPLETO, sin recortar (ej. "con rúcula y huevo" queda "con rúcula y huevo",
  NO solo "con huevo").
- Si el cliente NO aclara nada, dejá "observacion" VACÍA. NUNCA inventes ni agregues "con papas fritas"
  ni ninguna guarnición por tu cuenta: los platos ya vienen con su guarnición y la cocina la conoce.
- Si pide algo SIN o DISTINTO a lo de siempre, ahí SÍ ponelo (ej. "sin papas", "con puré en vez de papas").
- GUARNICIÓN QUE TAMBIÉN ES UN PLATO SUELTO: si en un plato que viene con guarnición el cliente elige
  una guarnición que además existe como plato aparte (papas fritas, puré, ensalada, etc.), va como
  "observacion" de ese plato — JAMÁS como un ítem separado. Ej: "milanesa con papas" = 1 Milanesa con
  observacion "con papas fritas" (NO 1 Milanesa + 1 Papas fritas). "bife con ensalada" = 1 Bife con
  observacion "con ensalada" (NO 1 Bife + 1 Ensalada).
- NO repitas en "observacion" la variedad que ya está en el nombre del plato elegido
  (ej. si el plato es "Milanesa napolitana", NO pongas "napolitana"). Salvo que el plato sea genérico
  y la variedad venga de un ALIAS: ahí SÍ va en "observacion" (como dice la regla de ALIAS).

PRECIO POR ÍTEM (opcional):
- Si el mensaje indica un precio para un ítem ("lomito a 20000", "2 pizzas a 15 lucas", "el barroluco 25 mil"),
  poné ese valor en "precio_unit" del ítem, SIEMPRE por UNIDAD.
- Convertí las formas habituales a número entero: "20 lucas" = 20000, "20 mil" = 20000, "20k" = 20000, "$18.500" = 18500.
- Si el precio dado es claramente el TOTAL de varias unidades ("2 lomitos por 40000"), dividilo por la cantidad
  para obtener el precio por unidad (40000 / 2 = 20000).
- Si el mensaje NO menciona precio para ese ítem, NO pongas "precio_unit" (se usará el precio del sistema).

OTRAS REGLAS:
- CAMBIOS: si el mensaje trae un "PEDIDO ACTUAL" y un "CAMBIO PEDIDO POR EL CLIENTE",
  devolvé el pedido COMPLETO con el cambio ya aplicado (agregá, quitá o modificá lo que pida,
  manteniendo el resto igual: items, cliente, dirección y hora que no se tocan se conservan).
- Interpretá cantidades escritas en palabras ("dos" = 2).
- HORA DE ENTREGA: si dan hora exacta usala ("21:45"). Si dan un tiempo relativo ("en 40 minutos",
  "en una hora"), SUMALO a la HORA ACTUAL y devolvé HH:MM (24hs). Si no la mencionan, dejá vacío.
- Si no aclara nombre o dirección, dejá esos campos vacíos.`;

export async function parsearPedidoIA(texto, platos, apiKey, modelo = 'claude-haiku-4-5', ahora = '', guarnicionDefault = 'papas fritas', imagen = null) {
  if (!apiKey) throw new Error('Falta la clave de IA (Claude)');
  const menu = platos.map((p) => {
    let l = `${p.id}: ${p.nombre} ($${Math.round(p.precio)})`;
    if (p.alias_ia && p.alias_ia.trim()) l += ` [alias: ${p.alias_ia.trim()}]`;
    if (p.guarnicion) l += ' [guarnición]';
    return l;
  }).join('\n');
  const system = SISTEMA.replace('{DEFAULT_GUARNICION}', guarnicionDefault);
  // El mensaje puede venir por texto o por FOTO (comanda escrita a mano / captura de chat).
  const contenido = [];
  if (imagen && imagen.base64) {
    contenido.push({ type: 'image', source: { type: 'base64', media_type: imagen.mediaType || 'image/jpeg', data: imagen.base64 } });
  }
  const instruccion = (imagen && imagen.base64)
    ? `El pedido viene en la IMAGEN de arriba (puede ser una comanda escrita a mano o una captura de chat). Leela e interpretá el pedido.${texto ? '\nAclaración por texto: ' + texto : ''}`
    : `MENSAJE DEL CLIENTE:\n${texto}`;
  contenido.push({ type: 'text', text: `MENU:\n${menu}\n\nHORA ACTUAL: ${ahora || '(no informada)'}\n\n${instruccion}` });
  const body = {
    model: modelo,
    max_tokens: 1024,
    system,
    tools: [HERRAMIENTA],
    tool_choice: { type: 'tool', name: 'registrar_pedido' },
    messages: [{ role: 'user', content: contenido }],
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), (imagen && imagen.base64) ? 35000 : 20000);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'La IA tardó demasiado en responder' : 'Error de red al consultar la IA: ' + e.message);
  } finally {
    clearTimeout(to);
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error('IA error ' + r.status + ': ' + t.slice(0, 200));
  }
  const data = await r.json();
  const tu = (data.content || []).find((b) => b.type === 'tool_use');
  if (!tu || !tu.input) throw new Error('La IA no devolvió un pedido');
  return tu.input; // { cliente_nombre, direccion, telefono, hora_entrega, items:[{plato_id,cantidad,observacion}], nota }
}
