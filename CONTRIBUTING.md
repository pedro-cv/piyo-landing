# Contributing to piyo-landing

This is the landing page of [piyo](https://github.com/pedro-cv/piyo-app), the free, ad-free transit app
for Santa Cruz de la Sierra. Issues and PRs may be written in Spanish or English.

## Not a developer?

- Write to [pedro.cv.dev@gmail.com](mailto:pedro.cv.dev@gmail.com) with an idea, a bug or a camba word.
- Or open an issue with the *Palabra camba* template.

## Quick contributions

- **A new word**: add one object to `src/data/words.json` (`word`, `meaning_es` in your own words,
  `translation_en`, `type`, `tag`, `source`). GitHub's web editor is enough; it opens the PR for you.
- **A game obstacle**: an entry in `src/data/obstacles.json` plus a sprite string in `src/scripts/sprites.ts`.

## Working locally

```sh
npm ci
npm run dev       # http://localhost:4321
npm run check     # must be green
npm run build
```

## Rules

1. `main` is protected: branch (`feat/…`, `fix/…`, `docs/…`), open a PR, CI must pass, squash-merge.
2. No analytics, trackers, ads or third-party scripts. Fonts and libraries are bundled from npm.
3. UI copy is Spanish with Bolivian voseo ("Probá", "Elegí"); code, comments and commits are English.
4. Motion must degrade under `prefers-reduced-motion`.
5. Only add images you own or that carry a reuse licence, and credit them in `src/data/site.json`.
6. Enable the secret-scan hook once per clone: `git config core.hooksPath .githooks`.

By contributing you agree your code is licensed under GPL-3.0-or-later.
