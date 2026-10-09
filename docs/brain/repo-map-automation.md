# Automatización del Repo Map

## Uso

Desde cualquier directorio del repositorio:

```powershell
# Comprueba la huella y genera solo si está desactualizado
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\brain\update-repo-map.ps1 -Mode Check

# Fuerza una actualización (útil para recuperación o diagnóstico)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\brain\update-repo-map.ps1 -Mode Update -Force

# Observa cambios; Ctrl+C lo detiene limpiamente
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\brain\update-repo-map.ps1 -Mode Watch

# Solicita una parada limpia a un observador en otra terminal/sesión
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\brain\update-repo-map.ps1 -Mode Stop
```

El script encuentra la raíz desde su propia ubicación. Usa el Python de `uv tool dir` (`aider-chat\Scripts\python.exe`) y ejecuta Aider con UTF-8, `--show-repo-map` y 4096 tokens. Esa opción solo imprime el mapa; el proceso no envía prompts ni llama a APIs de modelos.

El resultado se escribe primero a temporales. Solo una salida válida sustituye atómicamente `repo-map.md`, y solo si cambió. Si Aider falla, el mapa anterior se conserva. El fingerprint exitoso, el último intento, los bloqueos y el log se guardan bajo `.git/`; no se versionan. Una huella fallida no causa reintentos continuos: se reintentará cuando cambie el repositorio o en la siguiente comprobación de sesión.

Se incluyen cambios de contenido y rutas, borrados, cambios locales, rama, `HEAD` y marcadores de operaciones Git. Se excluyen `.git`, directorios de dependencias/build/caché, `docs/brain`, temporales, `.env*`, claves y credenciales. La huella no incluye el propio mapa. Los locks por archivo evitan observadores y generaciones duplicadas. El observador agrupa cambios por siete segundos y comprueba cada 1.5 segundos.

## OpenCode y Codex

OpenCode instalado en el entorno de desarrollo: **v2.0.26**. El plugin local está en `.opencode/plugins/repo-map-freshness.ts`; usa el contrato V2 documentado `Plugin.define` y `ctx.session.hook("prompt")`, por lo que valida la huella al cargar el plugin y antes de admitir cada prompt. OpenCode 2 no documenta el evento antiguo `file.edited`; la detección de cambios del filesystem la realiza el observador de PowerShell.

Codex puede comprobar la frescura antes de consultar el mapa ejecutando el comando `-Mode Check` de arriba. Para mantenerlo actualizado entre sesiones, se puede dejar `-Mode Watch` en una terminal o instalar la tarea de inicio de sesión indicada abajo. Las llamadas concurrentes comparten el mismo fingerprint y lock.

Antes de usar el mapa, los agentes deben correr `-Mode Check`, consultar únicamente las secciones/contexto relevantes y tratar siempre el código como fuente de verdad. No deben editar el Repo Map a mano ni forzar regeneraciones paralelas; el script y el observador se ocupan de la actualización.

## Inicio de sesión de Windows

La tarea `CancelacionesRepoMapObserver` ya está registrada con aprobación del owner para el usuario actual, `RunLevel Limited` y `LogonType Interactive`; se inició para la sesión actual. En cada inicio de sesión ejecuta PowerShell oculto con `-Mode Watch`. Tiene una sola instancia y no expira por tiempo de ejecución. No requiere administrador ni cambia políticas de seguridad o red.

Para revisar su estado:

```powershell
Get-ScheduledTask -TaskName 'CancelacionesRepoMapObserver'
Get-ScheduledTaskInfo -TaskName 'CancelacionesRepoMapObserver'
```

Si la tarea se elimina y se desea registrarla nuevamente, desde la raíz del repositorio y una sesión PowerShell del usuario:

```powershell
$script = (Resolve-Path .\scripts\brain\update-repo-map.ps1).Path
$user = "$env:USERDOMAIN\$env:USERNAME"
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Mode Watch" -WorkingDirectory (Get-Location).Path
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'CancelacionesRepoMapObserver' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Observador local del Repo Map de cancelaciones-ai'
```

Para detener el observador de forma cooperativa y conservar la tarea para el siguiente inicio de sesión:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\brain\update-repo-map.ps1 -Mode Stop
```

Para desactivar el inicio automático y eliminar la tarea:

```powershell
Disable-ScheduledTask -TaskName 'CancelacionesRepoMapObserver'
Unregister-ScheduledTask -TaskName 'CancelacionesRepoMapObserver' -Confirm:$false
```

También se puede iniciar y detener `-Mode Watch` manualmente con Ctrl+C.

## Recuperación

- **Aider falla:** el último `repo-map.md` válido queda intacto. Revisa `.git/repo-map-update.log`, confirma que `uv tool list` muestre `aider-chat`, y ejecuta `-Mode Check` de nuevo tras corregir el entorno. `-Force` permite reintentar el fingerprint fallido.
- **La generación fue interrumpida:** temporales se limpian al terminar normalmente; cualquier sobrante `%TEMP%\repo-map-*.out/.err/.ignore` se puede borrar manualmente. Los locks se liberan al salir el proceso.
- **Estado guardado inconsistente:** con el observador detenido, elimina `.git/repo-map-success.json` y `.git/repo-map-attempt.json`, luego corre `-Mode Check`. La huella ausente provoca regeneración.
- **No arranca Aider:** `-AiderPythonPath` permite indicar el `python.exe` correcto para diagnóstico. No se usa `aider.exe`.

## Evidencias y alcance de validación

El script registra por ejecución `FRESH`, `UPDATED`, `UNCHANGED`, `SKIP` o `ERROR`, junto con rama, cantidad de archivos y prefijo de huella en `.git/repo-map-update.log`. En esta implementación se verificó:

- El parser de PowerShell aceptó el script y Aider 0.86.2 generó el mapa con 4096 tokens; la comprobación siguiente devolvió `FRESH`.
- Creación y eliminación de un archivo detectadas como cambios de 274 a 275 y de vuelta a 274 archivos. La edición del mismo archivo cambió la huella. Una edición/renombre/eliminación durante una generación hizo que el temporal se descartara (`ERROR ... cambió mientras Aider generaba`) sin reemplazar el mapa.
- Una rama temporal local cambió la huella; se volvió a la rama original y se eliminó la rama de prueba.
- Se detuvo el observador mediante `-Mode Stop` y el log confirmó `WATCH detenido limpiamente`. Se inició de nuevo con un archivo de prueba creado durante la pausa y la primera comprobación lo detectó.
- Aider se hizo fallar apuntando a un `python.exe` inexistente: salió con error y el SHA-256 del mapa antes/después fue idéntico. Otro error de validación también conservó el mapa; la comprobación de sesión posterior recuperó y actualizó correctamente.
- Un archivo temporal exclusivo de `docs/brain` produjo `FRESH` con la misma huella; no se generó mapa por ese cambio.
- La invocación local ejecuta `python -m aider --no-analytics --show-repo-map --map-tokens 4096`. El Aider 0.86.2 instalado toma la rama `args.show_repo_map` en `aider/main.py`, imprime `coder.get_repo_map()` y retorna antes del flujo de chat; analytics también está desactivado. No se agregaron dependencias al paquete.

El observador fue ejercitado en esta sesión mediante `-Mode Watch`; la tarea de inicio se comprobó en estado `Running` y el log registró su inicio y la actualización inicial. La integración de OpenCode se implementó con las APIs V2 documentadas, pero requiere reiniciar OpenCode para cargar la versión final del plugin. No se ejecutó una sesión real de OpenCode para probar el hook `prompt`.
