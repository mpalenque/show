export const parte2Number = id => /^parte2:(6\d|7\d|80)$/.test(String(id)) ? Number(String(id).split(':')[1]) : null;
export const PARTE2_SCENES = Array.from({ length: 21 }, (_, i) => ({
  id: `parte2:${60 + i}`, name: `Parte 2 · ${60 + i}`, group: 'Parte 2', transition: 0,
}));
