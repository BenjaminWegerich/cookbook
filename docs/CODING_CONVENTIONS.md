# Coding Conventions for Cookbook

## Language

- **Write code in English.** This includes, but is not limited to variables, classes, files, comments.
- **Write documentation in English.** This includes comments, the `README.md`, as well as all files in docs/.
- **Write the UI in German.** An English version of the UI is not necessary, neither are other languages.
- **Actual recipe data will be in German.** This includes the recipes as well as ingredient units and other user-entered data.
- **Write Git commits in English.**

## Coding Conventions

- **Programming Languages:** TypeScript for the web app and the core logic module. The future
  Google Keep backend may use Python (isolated, see [ARCHITECTURE.md](ARCHITECTURE.md)).
  Recipe content is German data.
- **Naming Conventions and Casing:** camelCase for variables and functions, PascalCase for
  React components and types, kebab-case for file names, UPPER_SNAKE_CASE for constants.
- **Indentation and Brace Placement:** 2 spaces, no tabs; braces on the same line (1TBS),
  matching Prettier defaults.
- **Git Activities**: *Document branch conventions here when decided.* Use conventional commits.
