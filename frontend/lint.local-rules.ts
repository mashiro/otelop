import { defineRule, definePlugin } from "vite-plus/lint/plugins";

// Tailwind v4 can't scan a class built by string interpolation (see
// AGENTS.md's CSS/Styling conventions and lib/utils.ts's cn helper) — a
// template-literal className slips a dynamic fragment past the scanner
// silently, instead of erroring like an unknown class would. Catching the
// pattern statically keeps the codebase on cn().
const noTemplateLiteralClassName = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow template-literal classNames; build the class list with cn() from @/lib/utils instead.",
    },
    messages: {
      templateLiteralClassName:
        'className must not be a template literal — Tailwind cannot scan an interpolated fragment. Use cn(...) from "@/lib/utils" so every class stays a complete literal string.',
    },
  },
  create(context) {
    // Counted rather than matched on the attribute's root expression so a
    // template nested in a call or conditional — cn(`p-${size}`) — is caught
    // too; that form hides the fragment from Tailwind just the same.
    let classNameDepth = 0;
    const isClassName = (node: { name: { type: string; name?: unknown } }) =>
      node.name.type === "JSXIdentifier" && node.name.name === "className";
    return {
      JSXAttribute(node) {
        if (isClassName(node)) classNameDepth += 1;
      },
      "JSXAttribute:exit"(node) {
        if (isClassName(node)) classNameDepth -= 1;
      },
      TemplateLiteral(node) {
        if (classNameDepth > 0) context.report({ node, messageId: "templateLiteralClassName" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "local" },
  rules: { "no-template-literal-classname": noTemplateLiteralClassName },
});
