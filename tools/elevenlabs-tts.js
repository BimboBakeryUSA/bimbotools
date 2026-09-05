#!/usr/bin/env node
/**
 * elevenlabs-tts.js — genera audio (texto -> voz) con la API de ElevenLabs.
 *
 * No usa dependencias externas (solo Node >= 18, que trae fetch nativo),
 * en línea con el resto del repo (sin build, sin npm).
 *
 * Requiere la API key en la variable de entorno ELEVENLABS_API_KEY.
 * Nunca hardcodees la key en este archivo ni la subas a git.
 *
 * Uso:
 *   ELEVENLABS_API_KEY=sk_xxx node tools/elevenlabs-tts.js \
 *     --text "Texto a convertir en audio" \
 *     --voice <voice_id> \
 *     --out salida.mp3
 *
 *   # Leer el texto desde un archivo en vez de --text:
 *   node tools/elevenlabs-tts.js --text-file guion.txt --voice <voice_id>
 *
 *   # Listar las voces disponibles en la cuenta (para elegir voice_id):
 *   node tools/elevenlabs-tts.js --list-voices
 *
 * Flags:
 *   --text <string>       Texto a sintetizar.
 *   --text-file <path>    Alternativa a --text: lee el texto de un archivo.
 *   --voice <voice_id>    ID de la voz de ElevenLabs (ver --list-voices).
 *   --model <model_id>    Modelo TTS. Default: eleven_multilingual_v2.
 *   --out <path>          Archivo de salida .mp3. Default: out.mp3.
 *   --stability <0-1>     Estabilidad de la voz. Default: 0.5.
 *   --similarity <0-1>    Similarity boost. Default: 0.75.
 *   --list-voices         Solo lista las voces disponibles y sale.
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.elevenlabs.io';
const DEFAULT_MODEL = 'eleven_multilingual_v2';

function parseArgs(argv) {
  const args = { model: DEFAULT_MODEL, out: 'out.mp3', stability: 0.5, similarity: 0.75 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--text': args.text = argv[++i]; break;
      case '--text-file': args.textFile = argv[++i]; break;
      case '--voice': args.voice = argv[++i]; break;
      case '--model': args.model = argv[++i]; break;
      case '--out': args.out = argv[++i]; break;
      case '--stability': args.stability = parseFloat(argv[++i]); break;
      case '--similarity': args.similarity = parseFloat(argv[++i]); break;
      case '--list-voices': args.listVoices = true; break;
      case '-h':
      case '--help': args.help = true; break;
      default:
        console.error(`Flag desconocida: ${a}`);
        process.exit(1);
    }
  }
  return args;
}

function getApiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error(
      'Falta ELEVENLABS_API_KEY en el entorno.\n' +
      'Ejemplo: ELEVENLABS_API_KEY=sk_xxx node tools/elevenlabs-tts.js --text "..." --voice <id>'
    );
    process.exit(1);
  }
  return key;
}

async function listVoices(apiKey) {
  const res = await fetch(`${API_BASE}/v1/voices`, {
    headers: { 'xi-api-key': apiKey },
  });
  if (!res.ok) {
    throw new Error(`Error listando voces: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const voices = data.voices || [];
  if (voices.length === 0) {
    console.log('No se encontraron voces en esta cuenta.');
    return;
  }
  console.log(`${voices.length} voces disponibles:\n`);
  for (const v of voices) {
    const labels = v.labels || {};
    console.log(
      `${v.voice_id}  ${v.name}` +
      (labels.language ? `  [${labels.language}]` : '') +
      (labels.accent ? ` acento:${labels.accent}` : '') +
      (labels.description ? ` — ${labels.description}` : '')
    );
  }
}

async function generateAudio({ text, voice, model, out, stability, similarity }, apiKey) {
  const res = await fetch(`${API_BASE}/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability,
        similarity_boost: similarity,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs devolvió ${res.status}: ${body}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const outPath = path.resolve(process.cwd(), out);
  fs.writeFileSync(outPath, buffer);
  console.log(`Audio generado: ${outPath} (${buffer.length} bytes)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 33).join('\n'));
    return;
  }

  const apiKey = getApiKey();

  if (args.listVoices) {
    await listVoices(apiKey);
    return;
  }

  if (args.textFile) {
    args.text = fs.readFileSync(args.textFile, 'utf8');
  }

  if (!args.text) {
    console.error('Falta --text o --text-file.');
    process.exit(1);
  }
  if (!args.voice) {
    console.error('Falta --voice <voice_id>. Corré --list-voices para ver las opciones.');
    process.exit(1);
  }

  await generateAudio(args, apiKey);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
