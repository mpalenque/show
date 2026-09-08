import { ParameterStore } from './parameters.js';
import { Mapper } from './mappings.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate every section before an imported document can touch the live show. */
export function validateSession(data, registry) {
  if (data?.version !== 1 || data.system !== 'parte2') throw new Error('El archivo no es una sesión Parte 2 versión 1');
  const definitions = [...registry.defs.values()];
  const validateValues = values => {
    if (!object(values)) throw new TypeError('Los parámetros deben ser un objeto');
    const temporary = new ParameterStore(definitions);
    temporary.apply(values);
    return Object.fromEntries(Object.keys(values).map(id => [id, temporary.get(id)]));
  };
  const parameters = validateValues(data.parameters ?? {});
  let mappings;
  if (data.mappings != null) {
    const validator = new Mapper({ storage: null, defaults: data.mappings });
    mappings = validator.list(); validator.dispose();
    for (const row of mappings) {
      if (!registry.has(row.target) && !registry.actions.has(row.target)) throw new Error(`Destino de mapeo desconocido: ${row.target}`);
    }
  }
  if (!object(data.scenes ?? {})) throw new TypeError('Las escenas deben ser un objeto');
  const scenes = Object.fromEntries(Object.entries(data.scenes ?? {}).map(([id, values]) => {
    if (!/^(0|[1-9]\d*)$/.test(id) || Number(id) > 127) throw new Error(`Escena inválida: ${id}`);
    return [id, validateValues(values)];
  }));
  return { parameters, mappings, scenes };
}
