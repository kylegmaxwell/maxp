# Maxwell Experiments

Playing with fractals. Built with TypeScript and Vite, and hosted as a static site on GitHub Pages at https://kylegmaxwell.github.io/maxp/.

## Getting started

Set up Node first (see [WINDOWS.md](WINDOWS.md)). Then:

```bash
npm install
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |

## Project layout

- `index.html`: Vite entry page
- `src/`: application source (`main.ts` is the entry)
- `vite.config.ts`: build config (`base: '/maxp/'` for GitHub Pages)

## Other files

- [WINDOWS.md](WINDOWS.md): Windows / Git Bash setup (`gh`, Node via `fnm`)
- [CLAUDE.md](CLAUDE.md): guidance for AI assistants

## License

[MIT](LICENSE)
