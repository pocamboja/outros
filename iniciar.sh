#!/usr/bin/env sh
cd "$(dirname "$0")"
URL="http://localhost:8765"
( sleep 1; (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") ) &
echo "BeatVox a correr em $URL  —  Ctrl+C para parar."
python3 -m http.server 8765
