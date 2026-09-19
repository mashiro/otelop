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
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "className") return;
        const value = node.value;
        if (!value || value.type !== "JSXExpressionContainer") return;
        if (value.expression.type !== "TemplateLiteral") return;
        context.report({ node: value.expression, messageId: "templateLiteralClassName" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "local" },
  rules: { "no-template-literal-classname": noTemplateLiteralClassName },
});
