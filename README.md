# Webshotio

Webshotio is a production-focused screenshot API built with Node.js, Express, and Puppeteer.

## What This Service Does

- Captures PNG screenshots from public `http`/`https` URLs.
- Supports custom viewport size.
- Supports delayed capture for animation-heavy sites (`waitMs` / `wait`).
- Supports optional browser download behavior (`download` query parameter).
- Includes built-in security hardening and traffic controls for public usage.

## Highlights

- Reuses a warm Chromium browser instead of launching per request.
- Bounded concurrency with queue backpressure.
- SSRF protection for localhost, internal hostnames, and private/reserved IP ranges.
- Input validation with strict bounds.
- Per-IP rate limiting with standard rate-limit headers.
- Health and readiness endpoints.
- Graceful shutdown for process managers like PM2/systemd.

## Requirements

- Node.js 18+
- npm

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

Server starts on `PORT` (default `3000`).

## API

### `GET /screenshot`

Capture a PNG screenshot.

Query parameters:

- `url` (required): Target page URL (`http` or `https` only).
- `width` (optional): Viewport width.
- `height` (optional): Viewport height.
- `waitMs` (optional): Delay in milliseconds before capture.
- `wait` (optional): Alias for `waitMs`.
- `download` (optional): If present, response is sent as attachment with sanitized filename.

Rules:

- Use either `waitMs` or `wait`, not both.
- `download` is optional. If omitted, image is returned inline.
- URL must pass SSRF policy checks.

Response:

- `200 OK` with `Content-Type: image/png`

Example (inline):

```bash
curl -o shot.png "http://localhost:3000/screenshot?url=https://example.com&width=1280&height=800"
```

Example (wait for animation):

```bash
curl -o shot.png "http://localhost:3000/screenshot?url=https://example.com&waitMs=2000"
```

Example (attachment behavior in browser):

```bash
curl -OJ "http://localhost:3000/screenshot?url=https://example.com&download=homepage"
```

### `GET /health`

Liveness endpoint.

Returns queue and browser status.

### `GET /ready`

Readiness endpoint.

Returns `200` when accepting traffic and `503` while draining/shutting down.

## Error Format

Non-success responses return JSON:

```json
{
  "error": "ERROR_CODE",
  "message": "Human readable message"
}
```

Common status/code pairs:

- `400 INVALID_URL`
- `400 INVALID_DIMENSION`
- `400 INVALID_WAIT`
- `400 INVALID_DOWNLOAD`
- `403 URL_BLOCKED`
- `429 RATE_LIMITED`
- `503 QUEUE_FULL`
- `503 QUEUE_CLOSED`
- `504 REQUEST_TIMEOUT`
- `504 TASK_TIMEOUT` or `504 UPSTREAM_TIMEOUT`
- `500 INTERNAL_ERROR`

## Configuration

Environment variables are defined in `.env.example`.

### Server

- `PORT` (default: `3000`)
- `LOG_LEVEL` (`debug|info|warn|error`, default: `info`)
- `TRUST_PROXY` (default: `true` in sample env)

### Security

- `BLOCK_PRIVATE_NETWORK` (default: `true`)
- `ALLOWED_ORIGINS` (`*` or comma-separated origins)

### Timeouts And Rendering

- `REQUEST_TIMEOUT_MS` (default: `45000`)
- `NAVIGATION_TIMEOUT_MS` (default: `30000`)
- `SCREENSHOT_TIMEOUT_MS` (default: `15000`)
- `DEFAULT_WAIT_MS` (default: `0`)
- `MAX_WAIT_MS` (default: `15000`)
- `JOB_TIMEOUT_MS` (default: `40000`)
- `SHUTDOWN_TIMEOUT_MS` (default: `20000`)

### Viewport Bounds

- `DEFAULT_WIDTH` (default: `1280`)
- `DEFAULT_HEIGHT` (default: `800`)
- `MIN_WIDTH` (default: `320`)
- `MAX_WIDTH` (default: `2560`)
- `MIN_HEIGHT` (default: `240`)
- `MAX_HEIGHT` (default: `1600`)

### Throughput Controls

- `MAX_CONCURRENT_JOBS` (default: `8`)
- `MAX_QUEUE_SIZE` (default: `200`)
- `RATE_LIMIT_WINDOW_MS` (default: `60000`)
- `RATE_LIMIT_MAX` (default: `120`)

### Puppeteer

- `PUPPETEER_HEADLESS` (default: `true`)
- `PREWARM_BROWSER` (default: `true`)
- `CHROMIUM_ARGS` (comma-separated)
- `SCREENSHOT_USER_AGENT` (optional)

## Local Testing

Quick smoke test:

```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/health
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/ready
curl -s -o /tmp/screenshot.png -w "HTTP %{http_code} SIZE %{size_download}\n" "http://localhost:3000/screenshot?url=https://example.com&width=1200&height=800"
file /tmp/screenshot.png
```

Validation/security checks:

```bash
curl -s -w "\nHTTP %{http_code}\n" "http://localhost:3000/screenshot?url=notaurl"
curl -s -w "\nHTTP %{http_code}\n" "http://localhost:3000/screenshot?url=http://127.0.0.1"
curl -s -w "\nHTTP %{http_code}\n" "http://localhost:3000/screenshot?url=https://example.com&waitMs=999999"
```

Rate-limit check:

```bash
for i in $(seq 1 130); do curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/screenshot?url=notaurl"; done | tail -n 15
```

## Run With PM2

An example PM2 config is included in `ecosystem.config.cjs`.

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs webshotio
```

## Frontend Test UI

A minimal static browser UI is available in [frontend/README.md](frontend/README.md).

It can be hosted on GitHub Pages and is preconfigured to target:

`https://webshotio-screenshot-api.onrender.com`

The deployment workflow is in `.github/workflows/deploy-frontend-pages.yml`.

## Operational Notes

- The queue and rate limiter are in-memory. In multi-instance deployments, limits apply per instance.
- Browser download behavior is controlled by response headers. API does not write files on the server.
- `npm test` is currently a baseline command (`node --test`) and does not yet include a full test suite.

## License

MIT