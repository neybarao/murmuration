# Murmuration Lab

Configurable Canvas 2D particle background generator inspired by murmuration forms.

The interface lets you tune particle count, speed, turbulence, axis, shape, spread, scatter, colors, and trail behavior. It exports a small JavaScript module that can be embedded as a background in any web application.

## Local Preview

Open `index.html` directly in a browser, or run a local static server:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/
```

## Deploy

The repository includes a GitHub Actions workflow that deploys the static site to GitHub Pages whenever `main` is updated.

In GitHub, set Pages to use **GitHub Actions** as the source if it is not already configured.
