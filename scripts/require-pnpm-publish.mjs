// prepublishOnly guard. Only pnpm rewrites `workspace:` dependency ranges into real versions
// when it packs; `npm publish` ships them verbatim and the package cannot be installed
// (EUNSUPPORTEDPROTOCOL). Publish through `pnpm release` (CI) or `pnpm publish`.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("pnpm/")) {
  console.error(
    `Refusing to publish with "${agent.split(" ")[0] || "an unknown client"}": only pnpm replaces workspace: ` +
      "dependencies with real versions. Release through CI (pnpm release) or run `pnpm publish`.",
  );
  process.exit(1);
}
