# Maxwell Experiments

Playing with fractals. Built with TypeScript and Vite, and hosted as a static site on GitHub Pages at https://kylegmaxwell.github.io/maxp/.

## Getting started

Set up Node first (see [docs/WINDOWS.md](docs/WINDOWS.md)). Then:

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

- [docs/PROJECT.md](docs/PROJECT.md): project overview, modes, algorithms, and view system
- [docs/WINDOWS.md](docs/WINDOWS.md): Windows / Git Bash setup (`gh`, Node via `fnm`)
- [CLAUDE.md](CLAUDE.md): guidance for AI assistants
- [docs/IDEAS.md](docs/IDEAS.md): future ideas and 3D printing / meshing notes

## License

[MIT](LICENSE)
