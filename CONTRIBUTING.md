# Contributing

1. Fork the repository and create a focused branch.
2. Install Node.js 24+, run `npm ci`, then `npm test`.
3. For UI work, run `PORT=4317 npm start` and `npm run dev` in separate terminals.
4. Keep changes scoped. Add tests for new engine behavior and integration contracts.
5. Run `npm run build`. For infrastructure changes, run `docker compose up --build --wait` and `node tests/smoke.mjs`.
6. Open a pull request describing the problem, the resulting behavior, and what you verified.

Never commit real workspace data, recovery keys, provider credentials or encryption keys. Test external actions with injected fetchers or preview mode. Read [the plugin guide](docs/PLUGINS.md) before adding a connector.

Issues with clear reproduction steps and expected/actual behavior are welcome. Security concerns should be reported privately through the maintainer's GitHub profile; do not post working credentials or exploits against the hosted instance.
