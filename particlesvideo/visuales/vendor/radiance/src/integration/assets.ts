/** Public assets owned by Radiance, under the destination application's base. */
export const radianceAssetPath = (path: string): string => {
  const base = String(import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/');
  const relative = path.replace(/^\/+/, '').replace(/^radiance\//, '');
  return `${base}radiance/${relative}`;
};
