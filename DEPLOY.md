# GiuseCoder — Deploy su VPS (Hetzner / DigitalOcean / etc.)

## Requisiti
- VPS con Linux (Ubuntu/Debian)
- Docker installato
- Git installato

## Deploy rapido con Docker

```bash
# 1. SSH nel server
ssh root@TUO_IP

# 2. Installa Docker (se non c'è già)
curl -fsSL https://get.docker.com | sh

# 3. Clona il repo
git clone https://github.com/giuseppemignanocr7-create/giusecodex.git
cd giusecodex

# 4. Crea la cartella workspace (dove lavorerai sui progetti)
mkdir -p workspace

# 5. Build e avvia
docker compose up -d --build

# GiuseCoder è live su http://TUO_IP:4000
```

## Deploy manuale (senza Docker)

```bash
# 1. Installa Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

# 2. Clona e installa
git clone https://github.com/giuseppemignanocr7-create/giusecodex.git
cd giusecodex
npm ci

# 3. Build frontend
npm run build

# 4. Avvia il server
HOST=0.0.0.0 PORT=4000 PROJECT_ROOT=/root/workspace npx tsx server/index.ts
```

Per mantenerlo attivo usa **pm2**:
```bash
npm install -g pm2
HOST=0.0.0.0 PORT=4000 PROJECT_ROOT=/root/workspace pm2 start "npx tsx server/index.ts" --name giusecoder
pm2 save
pm2 startup
```

## HTTPS con Caddy (consigliato)

```bash
# Installa Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy

# Configura /etc/caddy/Caddyfile:
giusecoder.tuodominio.com {
    reverse_proxy localhost:4000
}

# Riavvia Caddy (SSL automatico via Let's Encrypt)
systemctl restart caddy
```

## Aggiornamento

```bash
cd giusecodex
git pull
docker compose up -d --build
# oppure senza Docker:
npm ci && npm run build && pm2 restart giusecoder
```

## Variabili d'ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `4000` | Porta server |
| `PROJECT_ROOT` | `cwd` | Directory workspace |
| `CODEX_AVAILABLE` | auto-detect | Forza codex CLI on/off |

## Feature disponibili su VPS vs Vercel

| Feature | VPS (Hetzner) | Vercel |
|---|---|---|
| Terminal reale | ✅ | ❌ |
| Agent tool loop | ✅ | ❌ |
| Git integration | ✅ | ❌ |
| Inline completion | ✅ | ❌ |
| Project search | ✅ | ❌ |
| Chat AI | ✅ | ✅ |
| Orchestrator | ✅ | ✅ |
| Editor + Preview | ✅ | ✅ |
