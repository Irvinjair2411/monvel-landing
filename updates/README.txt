CARPETA DE ACTUALIZACIONES DE MONVEL  (se sirve en https://monvel.mx/updates/)
================================================================================

Aquí viven los archivos que el botón "Buscar actualizaciones" de cada Monvel
consulta (PENDIENTES §23):

  • manifest.json        → manifiesto FIRMADO (MVUPD1). Dice qué versión hay,
                            las notas, la URL del ZIP y su sha256. Lo verifica
                            cada Monvel con la llave pública k1 antes de confiar.
  • monvel_<versión>.zip  → el paquete de código (Monvel_CFDI.html + MonvelAPP),
                            SIN secretos ni datos.

CÓMO SE GENERAN (no se editan a mano):
  Generador de Licencias → pestaña "Publicar actualización" → produce ambos
  archivos firmados en D:\MonvelLicencias\Publicar\.

CÓMO SE PUBLICAN:
  Corre  publicar_a_landing.ps1  (en la raíz del repo de Monvel): copia esos 2
  archivos aquí, hace commit y push. Cloudflare Pages publica monvel.mx/updates/
  en ~1-2 minutos.

NOTA: el archivo estático real gana al fallback de la landing, así que en cuanto
exista manifest.json aquí, monvel.mx/updates/manifest.json devuelve el JSON (no
el HTML de la página).
