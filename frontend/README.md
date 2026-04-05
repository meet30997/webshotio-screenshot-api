# Frontend Test UI

This folder contains a minimal static UI to test the screenshot API from a browser.

## Features

- URL input for target page
- Width, height, and wait controls
- Optional download filename
- PNG preview with open/download actions
- Friendly error display from API responses
- Rate-limit header visibility when available

Default API base URL:

https://webshotio-screenshot-api.onrender.com

## Run Locally

Serve the folder with any static server.

Example:

```bash
npx serve frontend --listen 4173
```

Then open:

http://localhost:4173

## Deploy To GitHub Pages

A workflow is included at:

.github/workflows/deploy-frontend-pages.yml

Steps:

1. Push changes to the main branch.
2. In GitHub repository settings, open Pages.
3. Set Source to GitHub Actions.
4. Wait for the workflow to publish the static artifact from the frontend folder.

## CORS Requirement

Your backend must allow your Pages origin.

Set ALLOWED_ORIGINS on the API service to include your Pages domain, for example:

https://<username>.github.io

If your repository uses project pages, include that full origin as well:

https://<username>.github.io/<repo>

## Notes

- This UI is static and build-free.
- It calls GET /screenshot and expects image/png on success.
- Error responses are expected in JSON format: { error, message }.
