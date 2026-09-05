# tools/

Scripts sueltos que no forman parte de la PWA (no se sirven al navegador).

## elevenlabs-tts.js

Genera audio a partir de texto usando la API de ElevenLabs. Solo Node.js
(>=18, usa `fetch` nativo), sin dependencias de npm.

**La API key nunca se hardcodea ni se sube al repo.** Se pasa por variable
de entorno en cada corrida:

```bash
export ELEVENLABS_API_KEY=sk_xxx   # no lo commitees ni lo pegues en código

# Ver qué voces hay disponibles en la cuenta (para elegir voice_id)
node tools/elevenlabs-tts.js --list-voices

# Generar un audio
node tools/elevenlabs-tts.js \
  --text "Texto que se va a convertir en audio" \
  --voice <voice_id> \
  --out salida.mp3

# O leyendo el texto de un archivo
node tools/elevenlabs-tts.js --text-file guion.txt --voice <voice_id> --out salida.mp3
```

Flags disponibles: `--text`, `--text-file`, `--voice`, `--model`
(default `eleven_multilingual_v2`), `--out` (default `out.mp3`),
`--stability`, `--similarity`, `--list-voices`, `--help`.

Los `.mp3` generados no se versionan (ver `.gitignore`).
