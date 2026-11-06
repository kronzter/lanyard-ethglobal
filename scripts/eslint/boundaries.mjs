// Local ESLint plugin enforcing Lanyard's track and runtime import boundaries
// (plans/00-README.md › Ownership of paths, plans/01-evidence-and-interfaces.md §3).
// One repo, one package: folders are the boundaries, so this rule resolves every
// import to a repo path and checks which zone it lands in.
import { builtinModules } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

const ZONES = [
  ["shared", ["src/shared/"]],
  [
    "trackA",
    ["src/ens/", "src/venue/", "src/components/venue/", "app/admin/ens/", "app/venue/", "contracts/src/ens/"],
  ],
  [
    "trackB",
    [
      "src/arkiv/",
      "src/rules/",
      "cli/",
      "app/volunteer/",
      "app/lead/",
      "app/tickets/",
      "app/judge/",
      "app/team/",
      "app/teams/",
      "app/organizer/",
    ],
  ],
];

// The only files allowed to import another track's concrete implementations.
const COMPOSITION_ROOTS = new Set(["src/providers.ts", "cli/providers.ts"]);

// Code that must run unchanged on Hermes, in the browser and on Node.
const PURE_RUNTIME = ["src/shared/", "src/rules/"];

const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const PLATFORM_PACKAGES = [/^react$/, /^react-dom$/, /^react-native($|[-/])/, /^expo($|[-/])/, /^@expo\//];

const toRepoPath = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");
const zoneOf = (rel) => ZONES.find(([, prefixes]) => prefixes.some((p) => rel.startsWith(p)))?.[0] ?? null;

function resolveSpecifier(spec, fromFile) {
  if (spec === "@" || spec.startsWith("@/")) return toRepoPath(path.join(ROOT, "src", spec.slice(2)));
  if (spec.startsWith(".")) return toRepoPath(path.resolve(path.dirname(fromFile), spec));
  return null; // bare package specifier
}

const boundaries = {
  meta: {
    type: "problem",
    docs: { description: "Enforce Lanyard track and runtime import boundaries" },
    schema: [],
    messages: {
      cli: "'{{from}}' must not import the Node-only CLI ('{{target}}').",
      crossTrack:
        "{{fromZone}} code must not import {{toZone}} code ('{{target}}'); go through src/shared interfaces and the composition roots (src/providers.ts, cli/providers.ts).",
      sharedOutward: "src/shared must stay track-neutral; it cannot import '{{target}}'.",
      impure: "'{{from}}' must run on Hermes, browser and Node; it cannot import '{{target}}'.",
      arkivNe:
        "The Arkiv node rejects '!=': never use '{{name}}()' from @arkiv-network/sdk; model status positively.",
    },
  },
  create(context) {
    const file = context.filename;
    const from = toRepoPath(file);
    if (from.startsWith("..")) return {};
    const fromZone = zoneOf(from);
    const isRoot = COMPOSITION_ROOTS.has(from);
    const isPure = PURE_RUNTIME.some((p) => from.startsWith(p));
    const inApp = from.startsWith("app/") || from.startsWith("src/");

    function check(node, spec, importNames) {
      if (typeof spec !== "string") return;
      if (/^@arkiv-network\/sdk($|\/)/.test(spec)) {
        for (const name of importNames) {
          if (name === "ne" || name === "not") context.report({ node, messageId: "arkivNe", data: { name } });
        }
      }
      if (isPure && (NODE_BUILTINS.has(spec) || PLATFORM_PACKAGES.some((re) => re.test(spec)))) {
        context.report({ node, messageId: "impure", data: { from, target: spec } });
        return;
      }
      const target = resolveSpecifier(spec, file);
      if (target === null) return;
      if (inApp && (target === "cli" || target.startsWith("cli/"))) {
        context.report({ node, messageId: "cli", data: { from, target } });
        return;
      }
      const toZone = zoneOf(`${target}/`);
      if (fromZone === "shared" && toZone !== null && toZone !== "shared") {
        context.report({ node, messageId: "sharedOutward", data: { target } });
        return;
      }
      if (fromZone === "shared" && /^(app|cli)(\/|$)|^src\/(shell|providers|flags)(\/|\.|$)/.test(target)) {
        context.report({ node, messageId: "sharedOutward", data: { target } });
        return;
      }
      if (
        !isRoot &&
        fromZone &&
        toZone &&
        fromZone !== toZone &&
        toZone !== "shared" &&
        fromZone !== "shared"
      ) {
        context.report({ node, messageId: "crossTrack", data: { fromZone, toZone, target } });
      }
    }

    const namesOf = (node) =>
      (node.specifiers ?? [])
        .filter((s) => s.type === "ImportSpecifier" || s.type === "ExportSpecifier")
        .map((s) => (s.imported ?? s.local)?.name ?? s.imported?.value);

    return {
      ImportDeclaration: (node) => check(node, node.source.value, namesOf(node)),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value, namesOf(node)),
      ExportAllDeclaration: (node) => check(node, node.source.value, []),
      ImportExpression: (node) => node.source.type === "Literal" && check(node, node.source.value, []),
      CallExpression: (node) => {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments[0]?.type === "Literal"
        ) {
          check(node, node.arguments[0].value, []);
        }
      },
    };
  },
};

export default { meta: { name: "lanyard" }, rules: { boundaries } };
