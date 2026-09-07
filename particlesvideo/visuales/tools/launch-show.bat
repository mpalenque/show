@echo off
REM Abre la salida en la pantalla LED (kiosk, 2688 x 1008) y el editor en el monitor.
REM Ajustar POS_X a la coordenada X donde empieza la LED en el escritorio extendido
REM (si la LED esta a la derecha de un monitor de 1920 de ancho, POS_X=1920).
set POS_X=1920
set URL=http://localhost:5173

start "" chrome --kiosk --window-position=%POS_X%,0 --window-size=2688,1008 --autoplay-policy=no-user-gesture-required --disable-features=CalculateNativeWinOcclusion %URL%/?clean
timeout /t 3 /nobreak >nul
start "" chrome --new-window --window-position=0,0 --window-size=1600,950 %URL%/editor.html
